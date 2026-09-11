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
    constant Field& field [[ buffer(2) ]])
{
    constexpr sampler s3(coord::normalized, filter::linear, address::clamp_to_edge);
    float3 uvw = (in.world - field.origin) * field.invExtent;
    float4 fv = float4(coverageField.sample(s3, uvw));
    float c = fv.a;
    // Ufanget flate får striper HER (samme skjermrom-mønster som sløret bak) — kamera-
    // bildet skal aldri synes; enten striper eller malt mesh, som Scaniverse.
    if (c < 0.40) {
        float stripe = stripeMaske(in.position.xy);
        return float4(mix(kHvit, kRod, stripe), 1.0);
    }
    float3 farge = fv.rgb / max(c, 0.01);   // premultiplisert → vektet snitt
    return float4(farge, 1.0);
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
