import Foundation
import simd

/// FUSJONSKJERNEN, delt (2026-10-27, M1 i docs/PROMPT_OPUS_SKANN_DELKART.md). Flyttet ut av
/// MeshTsdfBuild uten å endre en linje i `ampex_fuse`: baken (tett og sparsom) og live-fusjonen
/// i delkartene (MeshDelkartFusjon) bygger pipelines fra den samme strengen, så de KAN ikke
/// måle ulikt. Eneste tillegg er `ampex_integrate_live`, en ny kaller.
enum MeshFuseKernel {
    // MARK: - GPU-fusjon (2026-09-05)
    //
    // Polycam-veien. Nøyaktig samme MODELL som CPU-fusjonen over: samme kantfilter
    // per piksel, samme 1/d-vekt med gulv, samme tillit og JBU-normalisering, samme
    // trunkering foran og bak flaten. Forskjellen er samplingen: CPU-veien marsjerer
    // hver stråle i halve voxelsteg og skriver voxlene den treffer; GPU-veien besøker
    // hver voxel én gang og spør «hvilken måling ser meg?». Det er den samme
    // avstandsfunksjonen evaluert på et renere rutenett — ingen doble treff nær
    // kameraet, ingen hull mellom strålene langt unna.
    //
    // Kappløp finnes ikke: to summer (Σ w·d og Σ w) akkumuleres med atomiske
    // float-add per voxel, og S = Σwd/Σw regnes ut til slutt. Det er det VEKTEDE
    // SNITTET CPU-veien tilnærmer med sitt løpende snitt; taket på 40 legges på W
    // etterpå så terskler og glatting nedstrøms ser den samme skalaen.
    static let msl = """
    #include <metal_stdlib>
    using namespace metal;
    struct P {
        float4x4 w2c;
        float3 lo; float voxel;
        int3 dims; float trunc;
        float truncBehind; float fx, fy, cx;
        float cy; int dw, dh; float wf0;   // wf0 = trust * jbuNorm (per kart)
        int edgeRadius, jbuScale, _p0, _p1;
    };
    inline float dep(device const float* d, int x, int y, int w) { return d[y * w + x]; }
    inline float3 kamp(constant P& p, int px, int py, float pz) {
        return float3((float(px) - p.cx) / p.fx * pz, -(float(py) - p.cy) / p.fy * pz, -pz);
    }
    // Selve målingen ligger i ÉN inline-funksjon, og både det tette og det sparsomme
    // volumet kaller den. Da KAN de ikke komme i utakt — §102 er en lagringsendring,
    // ikke en modellendring, og det må være synlig i koden at den er det.
    inline void ampex_fuse(device atomic_float* sumWD, device atomic_float* sumW,
                           device const float* depth, constant P& p, int3 g, uint slot) {
        float3 wp = p.lo + (float3(g) + 0.5) * p.voxel;
        float4 pc = p.w2c * float4(wp, 1.0);
        float zc = -pc.z;
        if (zc < 0.3) return;
        // Samme projeksjon som CPU-veiens unprojeksjon, bare baklengs.
        float u = p.fx * pc.x / zc + p.cx;
        float v = -p.fy * pc.y / zc + p.cy;
        int x = int(u), y = int(v);
        if (x < 1 || y < 1 || x >= p.dw - 1 || y >= p.dh - 1) return;
        float z = dep(depth, x, y, p.dw);
        if (z <= 0.3 || z >= 5.0) return;
        // Kantfilter — identisk med CPU-veien (edgeRadius 0/1/2, skalert med JBU).
        float lim = max(0.04, 0.03 * z);
        bool edge = false;
        if (p.edgeRadius <= 0) {
            float dz = max(fabs(dep(depth, x + 1, y, p.dw) - z), fabs(dep(depth, x, y + 1, p.dw) - z));
            edge = dz > lim;
        } else {
            int r1 = p.jbuScale, r2 = 2 * p.jbuScale;
            int nx[8] = { x + r1, x - r1, x, x, x + r2, x - r2, x, x };
            int ny[8] = { y, y, y + r1, y - r1, y, y, y + r2, y - r2 };
            int n = p.edgeRadius >= 2 ? 8 : 4;
            for (int k = 0; k < n && !edge; k++) {
                if (nx[k] < 0 || ny[k] < 0 || nx[k] >= p.dw || ny[k] >= p.dh) continue;
                float dn = dep(depth, nx[k], ny[k], p.dw);
                if (dn > 0.3 && fabs(dn - z) > lim) edge = true;
            }
        }
        if (edge) return;
        // RETNINGSDELT FUSJON (§114). _p0 = −1: alle målinger. 0…5: bare piksler der flaten
        // vender mot akse ±a1, ±Y, ±a2 (a1/a2 = romrettede horisontalakser, yaw i _p1).
        // To sider av en tynn vegg havner da i hvert sitt volum og kan ikke nulle hverandre.
        if (p._p0 >= 0) {
            int r = 2 * max(1, p.jbuScale);
            int xa = max(x - r, 0), xb = min(x + r, p.dw - 1);
            int ya = max(y - r, 0), yb = min(y + r, p.dh - 1);
            float za = dep(depth, xa, y, p.dw), zb = dep(depth, xb, y, p.dw);
            float zu = dep(depth, x, ya, p.dw), zd = dep(depth, x, yb, p.dw);
            if (za <= 0.3 || zb <= 0.3 || zu <= 0.3 || zd <= 0.3) return;
            float3 c0 = kamp(p, x, y, z);
            float3 n = cross(kamp(p, xb, y, zb) - kamp(p, xa, y, za), kamp(p, x, yb, zd) - kamp(p, x, ya, zu));
            float nl = length(n);
            if (nl < 1e-9) return;
            n /= nl;
            if (dot(n, c0) > 0) n = -n;   // mot kameraet = mot friluft
            float3x3 R = float3x3(p.w2c[0].xyz, p.w2c[1].xyz, p.w2c[2].xyz);
            float3 nw = transpose(R) * n;
            float yaw = as_type<float>(p._p1);
            float cy = cos(yaw), sy = sin(yaw);
            float3 akser[6] = { float3(cy, 0, sy), float3(-cy, 0, -sy), float3(0, 1, 0),
                                float3(0, -1, 0), float3(-sy, 0, cy), float3(sy, 0, -cy) };
            if (dot(nw, akser[p._p0]) < 0.4) return;
        }
        // sceneDepth er Z-dybde: langs pikselens stråle er avstanden z·len, og voxelen
        // ligger ved zc·len. Signert avstand langs strålen = (z − zc)·len.
        float3 ray = float3((float(x) - p.cx) / p.fx, -(float(y) - p.cy) / p.fy, -1.0);
        float len = length(ray);
        float sdf = (z - zc) * len;
        if (sdf > p.trunc || sdf < -p.truncBehind) return;
        float d = clamp(sdf / p.trunc, -1.0, 1.0);
        float wf = max(0.25, min(1.5, 1.5 / max(z, 0.4))) * p.wf0;
        atomic_fetch_add_explicit(&sumWD[slot], d * wf, memory_order_relaxed);
        atomic_fetch_add_explicit(&sumW[slot],  wf,     memory_order_relaxed);
    }
    kernel void ampex_integrate(device atomic_float* sumWD [[buffer(0)]],
                                device atomic_float* sumW  [[buffer(1)]],
                                device const float* depth  [[buffer(2)]],
                                constant P& p              [[buffer(3)]],
                                uint3 gid [[thread_position_in_grid]]) {
        if (gid.x >= (uint)p.dims.x || gid.y >= (uint)p.dims.y || gid.z >= (uint)p.dims.z) return;
        uint i = (gid.z * p.dims.y + gid.y) * p.dims.x + gid.x;
        ampex_fuse(sumWD, sumW, depth, p, int3(gid), i);
    }
    // Sparsom: én tråd per voxel i en ALLOKERT blokk. `blocks[b]` er blokkens koordinat i
    // blokkrutenettet, og plassen i lageret er b*512 + lokal indeks — samme ordning som
    // `Blokkvolum.plass` på CPU-siden.
    kernel void ampex_integrate_sparse(device atomic_float* sumWD [[buffer(0)]],
                                       device atomic_float* sumW  [[buffer(1)]],
                                       device const float* depth  [[buffer(2)]],
                                       constant P& p              [[buffer(3)]],
                                       device const int4* blocks  [[buffer(4)]],
                                       uint gid [[thread_position_in_grid]]) {
        uint b = gid >> 9, l = gid & 511u;
        int4 bc = blocks[b];
        int3 g = int3(bc.x * 8 + int(l & 7u), bc.y * 8 + int((l >> 3) & 7u), bc.z * 8 + int(l >> 6));
        if (g.x >= p.dims.x || g.y >= p.dims.y || g.z >= p.dims.z) return;
        ampex_fuse(sumWD, sumW, depth, p, g, gid);
    }
    // Live (delkart, 2026-10-27): bare blokkene dette dybdekartet berører får tråder.
    // `blocks[b].w` er blokkens nummer i lageret, så plassen er w*512 + lokal indeks — samme
    // ordning som `Blokkvolum.plass`. Ny kaller; `ampex_fuse` er urørt.
    kernel void ampex_integrate_live(device atomic_float* sumWD [[buffer(0)]],
                                     device atomic_float* sumW  [[buffer(1)]],
                                     device const float* depth  [[buffer(2)]],
                                     constant P& p              [[buffer(3)]],
                                     device const int4* blocks  [[buffer(4)]],
                                     constant uint& antall      [[buffer(5)]],
                                     uint gid [[thread_position_in_grid]]) {
        uint b = gid >> 9, l = gid & 511u;
        if (b >= antall) return;
        int4 bc = blocks[b];
        int3 g = int3(bc.x * 8 + int(l & 7u), bc.y * 8 + int((l >> 3) & 7u), bc.z * 8 + int(l >> 6));
        if (g.x >= p.dims.x || g.y >= p.dims.y || g.z >= p.dims.z) return;
        ampex_fuse(sumWD, sumW, depth, p, g, uint(bc.w) * 512u + l);
    }
    """

    struct Params {
        var w2c: simd_float4x4
        var lo: SIMD3<Float>; var voxel: Float
        var dims: SIMD3<Int32>; var trunc: Float
        var truncBehind: Float; var fx: Float, fy: Float, cx: Float
        var cy: Float; var dw: Int32, dh: Int32; var wf0: Float
        var edgeRadius: Int32, jbuScale: Int32, p0: Int32, p1: Int32
    }
}
