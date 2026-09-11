#!/usr/bin/env python3
"""Run the actual CPU UV helper against the same cases as the Metal warp test."""
from pathlib import Path
import tempfile,subprocess
s=(Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshBakeV2.swift').read_text()
start=s.index('    static func warpedImageUV(');end=s.index('\n    }',start)+6
code='import simd\nenum Bake {\n'+s[start:end]+'\n}\n'+r'''
func near(_ a: SIMD2<Float>, _ b: SIMD2<Float>) { precondition(simd_length(a-b)<1e-6) }
let points: [SIMD2<Float>] = [.zero, SIMD2(0.2,0.8), SIMD2(0.5,0.5), SIMD2(1,1)]
for p in points { near(Bake.warpedImageUV(p,grid:Array(repeating:.zero,count:4),width:2,height:2),p) }
let shift=Array(repeating:SIMD2<Float>(0.1,-0.2),count:4)
near(Bake.warpedImageUV(.zero,grid:shift,width:2,height:2),SIMD2(0.1,0))
near(Bake.warpedImageUV(points[1],grid:shift,width:2,height:2),SIMD2(0.3,0.6))
near(Bake.warpedImageUV(points[3],grid:shift,width:2,height:2),SIMD2(1,0.8))
near(Bake.warpedImageUV(points[2],grid:[.zero,SIMD2(0.2,0),SIMD2(0,-0.2),SIMD2(0.2,-0.2)],width:2,height:2),SIMD2(0.6,0.4))
near(Bake.warpedImageUV(points[1],grid:[],width:8,height:5),points[1])
print("OK: 9 CPU warp assertions, matching the Metal test cases plus absent-grid identity")
'''
with tempfile.TemporaryDirectory(prefix='ampex-color-warp-') as d:
 p=Path(d)/'main.swift';p.write_text(code)
 subprocess.run(['swift','-module-cache-path',d+'/cache',str(p)],check=True)
