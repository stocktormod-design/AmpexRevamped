#include <metal_stdlib>
using namespace metal;
#include <SceneKit/scn_metal>

// ── Dekningsvisning (2026-09-06) ────────────────────────────────────────────
// To lag som spiller sammen:
//   1) MESHEN tegnes med kamerafargen fra dekningsfeltet DER flaten er fanget —
//      det er «previewet» du maler fram.
//   2) SLØRET (veilVert/veilFrag) ligger over ALT og er rødstripet. Per piksel
//      slår det opp LiDAR-dybden, regner verdenspunktet og forsvinner der flaten
//      er fanget. Alt annet blir stående rødt, også der ARKit ikke har mesh ennå.
// Tormod 2026-09-06: «ALT på hele skjermen skal starte rødstripet … du maler
// altså rommet/meshen og ser preview».

struct NodeUniforms {
    float4x4 modelTransform;
    float4x4 modelViewProjectionTransform;
};
struct Field {
    float3 origin;
    float3 invExtent;
    float voxel;
};
// LiDAR-dybden i samme ramme (CoverageField.Okklusjon). info.z = 0: ingen dybde.
struct Okk {
    float4x4 w2c;
    float4 K;       // fx, fy, cx, cy i dybdebildets piksler
    float4 info;    // bredde, høyde, har dybde, margin (m)
    float4 kamera;  // kameraets posisjon i verden
};
struct Veil {
    float4x4 camToWorld;
    float4x4 invProj;     // invers ARKit-projeksjon (skjermorientert)
    float4x4 uvXform;
    float4 originRange;   // xyz = feltets origo, w = maks rekkevidde
    float4 invExtent;
    float4 plane;         // w = har felt
};

// Målt på Scaniverse-opptak (2026-09-06, 1170 px bredt): rød #E2002A og hvit #FFFFFF
// vekselvis, HELT opake (kamerabildet synes ikke gjennom), periode ~20 px, 45°.
constant float3 kRod  = float3(0.886, 0.0, 0.165);
constant float3 kHvit = float3(1.0, 1.0, 1.0);

/** Diagonale striper i SKJERMROM, 20 px periode — låst til skjermen, som Scaniverse. */
inline float stripeMaske(float2 pos) {
    float s = (pos.x - pos.y) / 20.0;
    float f = fract(s);
    float w = max(fwidth(s) * 1.0, 0.01);
    return smoothstep(0.5 - w, 0.5 + w, f);
}

// ── 1) Meshen: kamerafargen der flaten er fanget ────────────────────────────

struct CoverageVertex {
    float3 position [[ attribute(SCNVertexSemanticPosition) ]];
    float4 color    [[ attribute(SCNVertexSemanticColor) ]];
};

struct CoverageOut {
    float4 position [[ position ]];
    float3 world;
    float4 color;
};

vertex CoverageOut coverageVert(
    CoverageVertex in            [[ stage_in ]],
    constant SCNSceneBuffer& scn_frame [[ buffer(0) ]],
    constant NodeUniforms&   scn_node  [[ buffer(1) ]])
{
    CoverageOut out;
    out.position = scn_node.modelViewProjectionTransform * float4(in.position, 1.0);
    out.world    = (scn_node.modelTransform * float4(in.position, 1.0)).xyz;
    out.color    = in.color;
    return out;
}

fragment float4 coverageFrag(
    CoverageOut in [[ stage_in ]],
    texture3d<half, access::sample> coverageField [[ texture(0) ]],
    texture2d<float, access::read> lidar [[ texture(1) ]],
    constant Field& field [[ buffer(2) ]],
    constant Okk& okk [[ buffer(3) ]])
{
    // BAK EN EKTE FLATE (2026-10-26). Overlegget er heldekkende, så der ARKit ennå ikke
    // har mesh på din side av en vegg, var det malte rommet på andre siden det eneste som
    // ble tegnet — «man kunne se gjennom veggen». LiDAR ser veggen før ARKit har meshet
    // den: et fragment mer enn `margin` bak dybden i samme piksel er skjult i virkeligheten,
    // og der skal overlegget si «ikke skannet her ennå», altså striper.
    bool harOkk = okk.info.z > 0.5;
    if (harOkk) {
        float3 pc = (okk.w2c * float4(in.world, 1.0)).xyz;
        float z = -pc.z;
        if (z > 0.05) {
            float u = okk.K.x * pc.x / z + okk.K.z;
            float v = -okk.K.y * pc.y / z + okk.K.w;
            if (u >= 0.0 && v >= 0.0 && u < okk.info.x && v < okk.info.y) {
                float d = lidar.read(uint2(u, v)).r;
                if (d > 0.3 && z > d + max(okk.info.w, 0.05 * d)) {
                    float stripe = stripeMaske(in.position.xy);
                    return float4(mix(kHvit, kRod, stripe), 1.0);
                }
            }
        }
    }
    // RINGBUFFER (2026-10-22): feltet er et vindu som følger kameraet, og voxel g bor på
    // plass g mod dims. Med `repeat` og verdenskoordinat / utstrekning blir det samme
    // adressering i shaderen, og lineær filtrering over ringsømmen blir riktig.
    constexpr sampler s3(coord::normalized, filter::linear, address::repeat);
    // Utenfor vinduet finnes ikke svaret her (det ligger på disk) — vis striper.
    float3 lokal = (in.world - field.origin) * field.invExtent;
    if (any(lokal < 0.0) || any(lokal >= 1.0)) {
        float stripe = stripeMaske(in.position.xy);
        return float4(mix(kHvit, kRod, stripe), 1.0);
    }
    // SLØYFE LANGS NORMALEN (2026-09-13). Feltet males der DYBDEKARTET traff; overlegget
    // leste det dér ARKit-MESHEN ligger. Det er ikke samme sted: verdensrammen glir mens
    // man går (målt på skannet 13.09: gulvplanet flytter seg 73 mm gjennom opptaket, §97),
    // og ARKit retter meshen etterpå — feltet står igjen der det ble malt. Målt på samme
    // skann: 40 % av mesh-hjørnene som HAR dekning innen ±2 voxler har INGENTING i sin
    // egen voxel, og andelen vegg over terskelen faller 40 → 22 %. Det er «stripene
    // reagerer ikke på den veggen»: man maler, men overlegget slår opp i tom luft.
    // Derfor: fem tapper langs flatens normal (0, ±1, ±2 voxler = ±8 cm), sterkeste vinner.
    // Prisen er at en flate inntil 8 cm foran en dekket flate kan arve dekningen (tynne
    // ting: karmer, radiatorer) — rett vei å ta feil på når alternativet er at veggen
    // aldri blir ferdig. Normalen kommer fra skjermderivatene av verdensposisjonen, så
    // geometrien trenger ikke normaler (live-meshen har ingen).
    float3 nrm = cross(dfdx(in.world), dfdy(in.world));
    float nl = length(nrm);
    nrm = nl > 1e-8 ? nrm / nl : float3(0.0);
    // SIDEN AV VEGGEN (2026-10-26). Tappene nådde ±10 cm begge veier, og en innervegg er
    // 10–15 cm tykk: flaten du står foran arvet malingen fra rommet på ANDRE siden. Med
    // kameraets posisjon vendes normalen mot kameraet, og bare ett steg (5 cm) går bakover.
    // Uten dybde (harOkk = false) er det som før: fem tapper, begge veier.
    int antall = 5;
    if (harOkk) {
        if (dot(nrm, okk.kamera.xyz - in.world) < 0.0) nrm = -nrm;
        antall = 4;
    }
    const float steg[5] = { 0.0, 1.0, -1.0, 2.0, -2.0 };
    const float vekt[5] = { 1.0, 0.95, 0.95, 0.85, 0.85 };
    float c = 0.0, cRaa = 0.0;
    float3 preFarge = float3(0.0);
    for (int k = 0; k < antall; ++k) {
        float3 uvw = (in.world + nrm * (steg[k] * field.voxel)) * field.invExtent;
        float4 fv = float4(coverageField.sample(s3, uvw));
        float s = fv.a * vekt[k];
        if (s > c) { c = s; cRaa = fv.a; preFarge = fv.rgb; }
    }
    // Ufanget flate får striper HER (samme skjermrom-mønster som sløret bak) — kamera-
    // bildet skal aldri synes; enten striper eller malt mesh, som Scaniverse.
    if (c < 0.40) {
        float stripe = stripeMaske(in.position.xy);
        return float4(mix(kHvit, kRod, stripe), 1.0);
    }
    float3 farge = preFarge / max(cRaa, 0.01);   // premultiplisert → vektet snitt
    return float4(farge, 1.0);
}

// ── 1b) Delkart (2026-10-27, M1): dekningen kommer fra fusjonsvekten W ──────────
// Hvert delkart har sin egen 5 cm-tekstur (rgb = forhåndsfarge, a = min(W/minWeight, 1)) i
// sitt eget koordinatsystem. a = 1 betyr at baken vil lage flate der — samme regel. Ingen
// trilineær blanding: en flate har tomme celler foran og bak seg, og et snitt av dem ville
// aldri nådd 1. Derfor nærmeste celle, og tapper langs normalen som før.
struct DelkartU {
    float4x4 w2d;      // verden → delkart
    float4 lo;         // xyz = teksturens nedre hjørne i delkartet (m), w = cellestørrelse
    float4 invExt;     // xyz = 1 / teksturens utstrekning (m), w = 1 om plassen er i bruk
};
struct DelkartListe {
    DelkartU d[8];
    float4 info;       // x = antall
};

inline float delkartOppslag(texture3d<half, access::sample> t, constant DelkartU& u, float3 p, thread float3& rgb) {
    // LINEÆR (2026-10-27): nærmeste celle ga 5 cm-trapper i kanten mellom dekket og udekket.
    constexpr sampler sn(coord::normalized, filter::linear, address::clamp_to_zero);
    float3 q = (u.w2d * float4(p, 1.0)).xyz;
    float3 uvw = (q - u.lo.xyz) * u.invExt.xyz;
    if (any(uvw < 0.0) || any(uvw >= 1.0)) return 0.0;
    float4 v = float4(t.sample(sn, uvw));
    rgb = v.rgb;
    return v.a;
}

fragment float4 delkartFrag(
    CoverageOut in [[ stage_in ]],
    texture3d<half, access::sample> d0 [[ texture(0) ]],
    texture3d<half, access::sample> d1 [[ texture(1) ]],
    texture3d<half, access::sample> d2 [[ texture(2) ]],
    texture3d<half, access::sample> d3 [[ texture(3) ]],
    texture3d<half, access::sample> d4 [[ texture(4) ]],
    texture3d<half, access::sample> d5 [[ texture(5) ]],
    texture3d<half, access::sample> d6 [[ texture(6) ]],
    texture3d<half, access::sample> d7 [[ texture(7) ]],
    texture2d<float, access::read> lidar [[ texture(8) ]],
    constant DelkartListe& delkart [[ buffer(2) ]],
    constant Okk& okk [[ buffer(3) ]])
{
    // Bak en ekte flate: striper (som coverageFrag).
    bool harOkk = okk.info.z > 0.5;
    if (harOkk) {
        float3 pc = (okk.w2c * float4(in.world, 1.0)).xyz;
        float z = -pc.z;
        if (z > 0.05) {
            float u = okk.K.x * pc.x / z + okk.K.z;
            float v = -okk.K.y * pc.y / z + okk.K.w;
            if (u >= 0.0 && v >= 0.0 && u < okk.info.x && v < okk.info.y) {
                float d = lidar.read(uint2(u, v)).r;
                if (d > 0.3 && z > d + max(okk.info.w, 0.05 * d)) {
                    return float4(mix(kHvit, kRod, stripeMaske(in.position.xy)), 1.0);
                }
            }
        }
    }
    float3 nrm = cross(dfdx(in.world), dfdy(in.world));
    float nl = length(nrm);
    nrm = nl > 1e-8 ? nrm / nl : float3(0.0);
    int antall = 5;
    if (harOkk) {
        if (dot(nrm, okk.kamera.xyz - in.world) < 0.0) nrm = -nrm;
        antall = 4;
    }
    const float steg[5] = { 0.0, 1.0, -1.0, 2.0, -2.0 };
    int n = int(delkart.info.x);
    float c = 0.0;
    float3 farge = float3(0.0);
    for (int k = 0; k < antall && c < 0.999; ++k) {
        for (int i = 0; i < n && c < 0.999; ++i) {
            constant DelkartU& u = delkart.d[i];
            float3 p = in.world + nrm * (steg[k] * u.lo.w);
            float3 rgb = float3(0.0);
            float a = 0.0;
            switch (i) {
                case 0: a = delkartOppslag(d0, u, p, rgb); break;
                case 1: a = delkartOppslag(d1, u, p, rgb); break;
                case 2: a = delkartOppslag(d2, u, p, rgb); break;
                case 3: a = delkartOppslag(d3, u, p, rgb); break;
                case 4: a = delkartOppslag(d4, u, p, rgb); break;
                case 5: a = delkartOppslag(d5, u, p, rgb); break;
                case 6: a = delkartOppslag(d6, u, p, rgb); break;
                default: a = delkartOppslag(d7, u, p, rgb); break;
            }
            if (a > c) { c = a; farge = rgb; }
        }
    }
    // GJENNOMSIKTIG NÅR DEKKET (2026-10-27, Tormod: «endre wireframe … det er der Scaniverse
    // gjør det bra»). Før ble en dekket flate malt med 5 cm-cellens snittfarge — grovt og
    // flekkete oppå et skarpt kamerabilde. Nå slipper flaten kamerabildet gjennom, og
    // stripene toner ut etter hvert som vekten kommer (alfa = 1 − c), i stedet for å slå
    // av ved 0,999. Sløret (veilFrag) ligger nå BAK alt med dybdetest, så der det ennå ikke
    // finnes mesh står stripene som før — kamerabildet vises aldri før flaten er fanget.
    (void)farge;
    float a = 1.0 - smoothstep(0.0, 0.999, c);
    return float4(mix(kHvit, kRod, stripeMaske(in.position.xy)), a);
}

// ── 2) Sløret: rødstripet over hele viewet, borte der flaten er fanget ──────

struct VeilVertex {
    float3 position [[ attribute(SCNVertexSemanticPosition) ]];
};

struct VeilOut {
    float4 position [[ position ]];
    float2 lokal;   // planets egne koordinater, [-1, 1]
};

vertex VeilOut veilVert(
    VeilVertex in                      [[ stage_in ]],
    constant SCNSceneBuffer& scn_frame [[ buffer(0) ]],
    constant NodeUniforms&   scn_node  [[ buffer(1) ]])
{
    VeilOut out;
    out.position = scn_node.modelViewProjectionTransform * float4(in.position, 1.0);
    out.lokal = in.position.xy;
    return out;
}

fragment float4 veilFrag(VeilOut in [[ stage_in ]])
{
    // Sløret er nå BAKGRUNNEN: opake striper over hele viewet, tegnet før meshen.
    // Meshen (coverageFrag) tegnes oppå og avgjør selv per piksel: striper eller farge.
    // Slik vises aldri rått kamerabilde i «hullet» mens ARKit-meshen henger etter.
    float stripe = stripeMaske(in.position.xy);
    return float4(mix(kHvit, kRod, stripe), 1.0);
}
