#!/usr/bin/env python3
"""Execute the native fixture packer: unchanged geometry, projection and fallback."""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshBakeV2.swift').read_text()
start = source.index('    static func projectiveFixtureUV(')
end = source.index('\n    // MARK: - Metal-rasterisering', start)
types = '''
import Foundation
enum ARMeshGlbExporter {
    struct UVUnwrapResult {
        var positions: [Float]; var normals: [Float]; var uvs: [Float]
        var indices: [UInt32]; var chartCount: Int; var atlasSize: Int
    }
}
'''
checks = r'''
let mesh = ARMeshGlbExporter.UVUnwrapResult(
    positions: [0,0,-2, 1,0,-3, 0,1,-2, 1,1,-3],
    normals: Array(repeating: [Float(0),0,1], count: 4).flatMap { $0 },
    uvs: [0,0, 1,0, 0,1, 1,1], indices: [0,1,2, 1,3,2, 0,2,3], chartCount: 1, atlasSize: 512)
var projected: [SIMD2<Float>] = mesh.indices.map { v in
    let i = Int(v) * 3, z = -mesh.positions[i + 2]
    return SIMD2(100 * mesh.positions[i]/z + 100, -100 * mesh.positions[i+1]/z + 100)
}
projected[6] = SIMD2(repeating: .nan) // Whole face must use original UVs.
let result = Bake.projectiveFixtureUV(uv: mesh, region: [0,1,0], projected: projected, atlasSize: 512)!
assert(result.uv.indices == Array(0..<UInt32(9)))
assert(result.uv.chartCount == 3 && result.projectedTriangles == 2)
for c in 0..<9 {
    for j in 0..<3 {
        assert(result.uv.positions[c*3+j] == mesh.positions[Int(mesh.indices[c])*3+j])
        assert(result.uv.normals[c*3+j] == mesh.normals[Int(mesh.indices[c])*3+j])
    }
}
let q: [SIMD2<Float>] = (0..<9).map { SIMD2(result.uv.uvs[$0*2], result.uv.uvs[$0*2+1]) * 512 }
for t in 0..<3 {
    for j in 1..<3 {
        let a = t*3, b = a+j
        let expected: SIMD2<Float>
        if t < 2 { expected = (projected[b] - projected[a]) * result.scale }
        else {
            let va = Int(mesh.indices[a]), vb = Int(mesh.indices[b])
            expected = SIMD2(mesh.uvs[vb*2]-mesh.uvs[va*2], mesh.uvs[vb*2+1]-mesh.uvs[va*2+1]) * 512 * result.scale
        }
        assert(abs((q[b]-q[a]-expected).x) < 0.0002 && abs((q[b]-q[a]-expected).y) < 0.0002)
    }
}
for p in q { assert(p.x >= 8 && p.y >= 8 && p.x <= 504 && p.y <= 504) }
for a in 0..<3 { for b in (a+1)..<3 {
    let pa = Array(q[a*3..<a*3+3]), pb = Array(q[b*3..<b*3+3])
    assert(pa.map{$0.x}.max()! + 15.9 <= pb.map{$0.x}.min()!
        || pb.map{$0.x}.max()! + 15.9 <= pa.map{$0.x}.min()!
        || pa.map{$0.y}.max()! + 15.9 <= pb.map{$0.y}.min()!
        || pb.map{$0.y}.max()! + 15.9 <= pa.map{$0.y}.min()!)
}}
assert(Bake.projectiveFixtureUV(uv: mesh, region: [0], projected: projected, atlasSize: 512) == nil)
let repeatRun = Bake.projectiveFixtureUV(uv: mesh, region: [0,1,0], projected: projected, atlasSize: 512)!
assert(repeatRun.uv.uvs == result.uv.uvs)
print("PASS: native projective layout preserves corners/normals, projected UV differences, whole-face fallback, padding and determinism")
'''
with tempfile.TemporaryDirectory(prefix='ampex-projective-check-') as folder:
    path = Path(folder)/'main.swift'
    path.write_text(types+'enum Bake {\n'+source[start:end]+'\n}\n'+checks)
    subprocess.run(['swift', '-module-cache-path', folder+'/cache', str(path)], check=True)
