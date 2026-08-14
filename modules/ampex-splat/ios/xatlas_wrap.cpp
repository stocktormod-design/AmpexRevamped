#include "xatlas_wrap.h"
#include "xatlas.h"
#include <cstdlib>
#include <cstring>
#include <vector>
#include <unordered_map>

static XatlasProgressFn g_progressFn = nullptr;

extern "C" void xatlas_set_progress(XatlasProgressFn fn) { g_progressFn = fn; }

static bool progressTrampoline(xatlas::ProgressCategory category, int progress, void*) {
    if (g_progressFn) return g_progressFn((int)category, progress) != 0;
    return true;
}

// Unwrap. `triChunk` (per-triangel chunk-id, f.eks. ARKit-anchor-indeks) kan være NULL → alt som
// ett mesh. Med chunks legges hver chunk inn som EGET xatlas-mesh: hver for seg er de små og
// nesten-manifolde (det er sammenslåingen av overlappende anchors som gir patologisk topologi
// og henger chart-veksten). Generate() pakker alle chunk-charts i samme atlas.
extern "C" XatlasResult xatlas_unwrap(const float* positions, uint32_t inVertexCount,
                                      const float* normals,
                                      const uint32_t* indices, uint32_t inIndexCount,
                                      const uint32_t* triChunk,
                                      uint32_t resolution) {
    XatlasResult out;
    memset(&out, 0, sizeof(out));
    if (!positions || !indices || inVertexCount == 0 || inIndexCount == 0) return out;
    const uint32_t triCount = inIndexCount / 3;

    xatlas::Atlas* atlas = xatlas::Create();
    xatlas::SetProgressCallback(atlas, progressTrampoline, nullptr);

    // Grupper triangler per chunk (én gruppe hvis triChunk er NULL).
    std::vector<std::vector<uint32_t>> chunkTris; // triangelindekser per chunk
    if (triChunk) {
        std::unordered_map<uint32_t, size_t> chunkSlot;
        for (uint32_t t = 0; t < triCount; ++t) {
            auto it = chunkSlot.find(triChunk[t]);
            if (it == chunkSlot.end()) {
                it = chunkSlot.emplace(triChunk[t], chunkTris.size()).first;
                chunkTris.emplace_back();
            }
            chunkTris[it->second].push_back(t);
        }
    } else {
        chunkTris.emplace_back();
        chunkTris[0].reserve(triCount);
        for (uint32_t t = 0; t < triCount; ++t) chunkTris[0].push_back(t);
    }

    // Bygg lokale mesh per chunk. localToGlobal[m][lokal verteks] = global verteksindeks.
    std::vector<std::vector<uint32_t>> localToGlobal;
    std::vector<std::vector<float>> localPos, localNorm;
    std::vector<std::vector<uint32_t>> localIdx;
    localToGlobal.reserve(chunkTris.size());
    for (const auto& tris : chunkTris) {
        if (tris.empty()) continue;
        std::unordered_map<uint32_t, uint32_t> g2l;
        std::vector<uint32_t> l2g;
        std::vector<float> lp, ln;
        std::vector<uint32_t> li;
        li.reserve(tris.size() * 3);
        for (uint32_t t : tris) {
            for (int k = 0; k < 3; ++k) {
                const uint32_t g = indices[t * 3 + k];
                auto it = g2l.find(g);
                if (it == g2l.end()) {
                    const uint32_t l = (uint32_t)l2g.size();
                    it = g2l.emplace(g, l).first;
                    l2g.push_back(g);
                    lp.push_back(positions[g * 3 + 0]);
                    lp.push_back(positions[g * 3 + 1]);
                    lp.push_back(positions[g * 3 + 2]);
                    if (normals) {
                        ln.push_back(normals[g * 3 + 0]);
                        ln.push_back(normals[g * 3 + 1]);
                        ln.push_back(normals[g * 3 + 2]);
                    }
                }
                li.push_back(it->second);
            }
        }
        localToGlobal.push_back(std::move(l2g));
        localPos.push_back(std::move(lp));
        localNorm.push_back(std::move(ln));
        localIdx.push_back(std::move(li));
    }

    for (size_t m = 0; m < localPos.size(); ++m) {
        xatlas::MeshDecl meshDecl;
        meshDecl.vertexCount = (uint32_t)(localPos[m].size() / 3);
        meshDecl.vertexPositionData = localPos[m].data();
        meshDecl.vertexPositionStride = sizeof(float) * 3;
        if (normals) {
            meshDecl.vertexNormalData = localNorm[m].data();
            meshDecl.vertexNormalStride = sizeof(float) * 3;
        }
        meshDecl.indexCount = (uint32_t)localIdx[m].size();
        meshDecl.indexData = localIdx[m].data();
        meshDecl.indexFormat = xatlas::IndexFormat::UInt32;
        if (xatlas::AddMesh(atlas, meshDecl, (uint32_t)localPos.size()) != xatlas::AddMeshError::Success) {
            xatlas::Destroy(atlas);
            return out;
        }
    }

    xatlas::ChartOptions chartOptions;
    // Store, få charts: chart-growing dominerer kjøretiden på støyete LiDAR-mesh.
    chartOptions.maxCost = 8.0f;           // default 2.0
    chartOptions.normalSeamWeight = 1.5f;  // default 4.0
    xatlas::PackOptions packOptions;
    packOptions.resolution = resolution;
    packOptions.padding = 2;
    packOptions.blockAlign = true;
    xatlas::Generate(atlas, chartOptions, packOptions);

    if (atlas->meshCount < 1 || atlas->width == 0 || atlas->height == 0) {
        xatlas::Destroy(atlas);
        return out;
    }

    // Slå sammen output-meshene til én buffer (global posisjon/normal via localToGlobal).
    uint32_t totalV = 0, totalI = 0;
    for (uint32_t m = 0; m < atlas->meshCount; ++m) {
        totalV += atlas->meshes[m].vertexCount;
        totalI += atlas->meshes[m].indexCount;
    }
    out.positions = (float*)malloc(sizeof(float) * 3 * totalV);
    out.normals   = (float*)malloc(sizeof(float) * 3 * totalV);
    out.uvs       = (float*)malloc(sizeof(float) * 2 * totalV);
    out.indices   = (uint32_t*)malloc(sizeof(uint32_t) * totalI);
    if (!out.positions || !out.normals || !out.uvs || !out.indices) {
        free(out.positions); free(out.normals); free(out.uvs); free(out.indices);
        memset(&out, 0, sizeof(out));
        xatlas::Destroy(atlas);
        return out;
    }

    const float w = (float)atlas->width;
    const float h = (float)atlas->height;
    uint32_t vOff = 0, iOff = 0;
    for (uint32_t m = 0; m < atlas->meshCount; ++m) {
        const xatlas::Mesh& mesh = atlas->meshes[m];
        const std::vector<uint32_t>& l2g = localToGlobal[m];
        for (uint32_t i = 0; i < mesh.vertexCount; ++i) {
            const xatlas::Vertex& v = mesh.vertexArray[i];
            const uint32_t g = l2g[v.xref];
            const uint32_t o = vOff + i;
            out.positions[o*3+0] = positions[g*3+0];
            out.positions[o*3+1] = positions[g*3+1];
            out.positions[o*3+2] = positions[g*3+2];
            if (normals) {
                out.normals[o*3+0] = normals[g*3+0];
                out.normals[o*3+1] = normals[g*3+1];
                out.normals[o*3+2] = normals[g*3+2];
            } else {
                out.normals[o*3+0] = 0.0f; out.normals[o*3+1] = 1.0f; out.normals[o*3+2] = 0.0f;
            }
            out.uvs[o*2+0] = v.uv[0] / w;
            out.uvs[o*2+1] = v.uv[1] / h;
        }
        for (uint32_t i = 0; i < mesh.indexCount; ++i) {
            out.indices[iOff + i] = mesh.indexArray[i] + vOff;
        }
        vOff += mesh.vertexCount;
        iOff += mesh.indexCount;
    }

    out.vertexCount = totalV;
    out.indexCount = totalI;
    out.atlasWidth = atlas->width;
    out.atlasHeight = atlas->height;
    out.ok = 1;

    xatlas::Destroy(atlas);
    return out;
}

extern "C" void xatlas_free(XatlasResult* r) {
    if (!r) return;
    free(r->positions); free(r->normals); free(r->uvs); free(r->indices);
    r->positions = nullptr; r->normals = nullptr; r->uvs = nullptr; r->indices = nullptr;
}
