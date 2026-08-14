#include <metal_stdlib>
using namespace metal;
#include <SceneKit/scn_metal>

// scn_node: define only the fields we need; SceneKit binds by argument name, not type name.
struct NodeUniforms {
    float4x4 modelViewProjectionTransform;
};

struct CoverageVertex {
    float3 position [[ attribute(SCNVertexSemanticPosition) ]];
    float4 color    [[ attribute(SCNVertexSemanticColor) ]];
};

struct CoverageOut {
    float4 position [[ position ]];
    float4 color;
};

vertex CoverageOut coverageVert(
    CoverageVertex in            [[ stage_in ]],
    constant SCNSceneBuffer& scn_frame [[ buffer(0) ]],
    constant NodeUniforms&   scn_node  [[ buffer(1) ]])
{
    CoverageOut out;
    out.position = scn_node.modelViewProjectionTransform * float4(in.position, 1.0);
    out.color    = in.color;
    return out;
}

// barycentric_coord: GPU-provided (u,v,w) inside each triangle.
// min(u,v,w) == 0 at edges, peaks at vertices — perfect for wireframe line detection.
fragment float4 coverageFrag(
    CoverageOut in   [[ stage_in ]],
    float3      bary [[ barycentric_coord ]])
{
    float d     = min(bary.x, min(bary.y, bary.z));
    float w     = fwidth(d);                          // pixel-accurate derivative for AA
    float alpha = 1.0 - smoothstep(0.0, w * 1.5, d); // ~1.5 px anti-aliased edge
    if (alpha < 0.02) discard_fragment();
    return float4(in.color.rgb, alpha * 0.88);
}
