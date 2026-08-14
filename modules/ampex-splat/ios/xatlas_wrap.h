// C bridge over xatlas (C++) so Swift can call it via the bridging header.
// Requires xatlas.h + xatlas.cpp added to the App target (https://github.com/jpcy/xatlas).
#ifndef XATLAS_WRAP_H
#define XATLAS_WRAP_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float* positions;   // 3 * vertexCount
    float* normals;     // 3 * vertexCount
    float* uvs;         // 2 * vertexCount, normalized 0..1
    uint32_t* indices;  // indexCount
    uint32_t vertexCount;
    uint32_t indexCount;
    uint32_t atlasWidth;
    uint32_t atlasHeight;
    int ok;             // 1 on success, 0 on failure
} XatlasResult;

// Progress under unwrap: category (0=AddMesh 1=ComputeCharts 2=PackCharts 3=BuildOutputMeshes),
// percent 0..100. Kalles fra xatlas' arbeidstråd. Returner 0 for å AVBRYTE unwrappen
// (xatlas_unwrap gir da ok=0 → caller faller tilbake til box-unwrap).
typedef int (*XatlasProgressFn)(int category, int percent);
void xatlas_set_progress(XatlasProgressFn fn);

// Unwrap a triangle mesh into a UV atlas. `normals` may be NULL.
// positions: 3*inVertexCount floats, indices: inIndexCount uint32.
// triChunk: per-triangel chunk-id (lengde inIndexCount/3, f.eks. ARKit-anchor-indeks) eller NULL.
// Med chunks unwrappes hver chunk som eget xatlas-mesh (robust mot overlapp-topologi) og alle
// charts pakkes i samme atlas. Caller must call xatlas_free() on the result.
XatlasResult xatlas_unwrap(const float* positions, uint32_t inVertexCount,
                           const float* normals,
                           const uint32_t* indices, uint32_t inIndexCount,
                           const uint32_t* triChunk,
                           uint32_t resolution);

void xatlas_free(XatlasResult* r);

#ifdef __cplusplus
}
#endif

#endif /* XATLAS_WRAP_H */
