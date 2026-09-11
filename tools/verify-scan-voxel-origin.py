#!/usr/bin/env python3
"""Exercise production Surface Nets vertex extraction on analytic planes.
TSDF samples are located at voxel centers, as in the production Metal kernel.
"""
from pathlib import Path
import subprocess
import tempfile

source=(Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshTsdfBuild.swift').read_text()
start=source.index('        var cell =',source.index('private static func surfaceNets('))
end=source.index('        guard !verts.isEmpty',start)
body=source[start:end]
swift='''import Foundation
import simd
func extract(sdf: UnsafeMutablePointer<Float>, wgt: UnsafeMutablePointer<Float>,
             dim: SIMD3<Int>, lo: SIMD3<Float>, vox: Float, minW: Float) -> [SIMD3<Float>] {
'''+body+'''return verts
}
let dim=SIMD3<Int>(9,9,9)
let normals: [SIMD3<Float>] = [SIMD3(1,0,0),SIMD3(0,1,0),SIMD3(0,0,1),
                             simd_normalize(SIMD3(0.54,-0.017,0.84))]
var checks=0
for vox: Float in [0.01,0.02,0.04] {
 for lo: SIMD3<Float> in [SIMD3(-0.08,-0.08,-0.08),SIMD3(1.13,-2.07,0.91)] {
  for normal in normals {
   let point=lo+SIMD3<Float>(repeating:4.2*vox)
   var field=[Float]();var weights=[Float](repeating:1,count:729)
   for z in 0..<9 {for y in 0..<9 {for x in 0..<9 {
    let center=lo+(SIMD3<Float>(Float(x),Float(y),Float(z))+SIMD3<Float>(repeating:0.5))*vox
    field.append(simd_dot(normal,center-point))
   }}}
   let vertices=field.withUnsafeMutableBufferPointer { s in weights.withUnsafeMutableBufferPointer { w in
    extract(sdf:s.baseAddress!,wgt:w.baseAddress!,dim:dim,lo:lo,vox:vox,minW:0.1)
   }}
   guard !vertices.isEmpty else {print("FAIL: plane missing");exit(1)}
   let error=vertices.map {abs(simd_dot(normal,$0-point))}.max()!
   guard error<0.00001 else {print("FAIL: voxel=",vox,"normal=",normal,"plane displacement mm=",error*1000);exit(1)}
   checks += 1
  }
 }
}
print("OK:",checks,"analytic planes through production Surface Nets vertex extraction")
'''
with tempfile.TemporaryDirectory(prefix='ampex-voxel-origin-') as folder:
    path=Path(folder)/'main.swift';path.write_text(swift)
    subprocess.run(['swift','-module-cache-path',folder+'/cache',str(path)],check=True)
