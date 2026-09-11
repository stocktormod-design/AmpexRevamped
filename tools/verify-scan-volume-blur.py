#!/usr/bin/env python3
"""Exercise production volume smoothing at row/slice boundaries and in the interior."""
from pathlib import Path
import subprocess,tempfile
s=(Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshTsdfBuild.swift').read_text()
a=s.index('    private static func blurVolume(');b=s.index('\n    }',a)+6
method=s[a:b].replace('private static func','func')
checks=r'''
func run(_ dim: SIMD3<Int>, _ input: [Float], _ weights:[Float]) -> [Float] {
 var s=input, w=weights
 s.withUnsafeMutableBufferPointer { sp in w.withUnsafeMutableBufferPointer { wp in
  blurVolume(sp.baseAddress!,wgt:wp.baseAddress!,count:s.count,dim:dim,passes:1,minW:4)
 }}
 return s
}
func check(_ ok:Bool,_ name:String) {if !ok {print("FAIL:",name);exit(1)}}
// These occupied voxels are adjacent in memory, but not in 3D.
for pair in [(2,3),(5,6),(3,6)] {
 var s=[Float](repeating:0,count:12),w=s
 s[pair.0]=0.5;s[pair.1] = -0.5;w[pair.0]=10;w[pair.1]=10
 let out=run(SIMD3(3,2,2),s,w)
 check(abs(out[pair.0]-0.5)<1e-6 && abs(out[pair.1]+0.5)<1e-6,"row/slice must not wrap: \(pair)")
}
// Constant fully observed fields stay constant, including boundaries.
let constant=run(SIMD3(5,5,5),[Float](repeating:0.37,count:125),[Float](repeating:8,count:125))
check(constant.allSatisfy {abs($0-0.37)<1e-6},"constant field")
// A linear SDF remains linear in the interior, preserving its zero surface.
var linear=[Float]()
for z in 0..<5 {for y in 0..<5 {for x in 0..<5 {linear.append(Float(x+2*y+3*z)-12)}}}
let smooth=run(SIMD3(5,5,5),linear,[Float](repeating:8,count:125))
for z in 1..<4 {for y in 1..<4 {for x in 1..<4 {
 let i=(z*5+y)*5+x;check(abs(smooth[i]-linear[i])<1e-6,"linear interior")
}}}
print("OK: row/slice isolation, constant field, 27 linear interior voxels")
'''
# Capture count before mutable borrow to respect Swift exclusivity.
checks=checks.replace('var s=input, w=weights','var s=input, w=weights\n let count=s.count').replace('count:s.count','count:count')
with tempfile.TemporaryDirectory(prefix='ampex-volume-blur-') as folder:
 p=Path(folder)/'main.swift';p.write_text('import Foundation\n'+method+'\n'+checks)
 subprocess.run(['swift','-module-cache-path',folder+'/cache',str(p)],check=True)
