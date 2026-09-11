#!/usr/bin/env python3
"""Synthetic known-shift test executing the actual native registration implementation."""
from pathlib import Path
import subprocess,tempfile
s=(Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshPoseRefineV2.swift').read_text()
a=s.index('    private struct Frame {');b=s.index('\n    }',a)+6
frame=s[a:b].replace('private struct','struct')
a=s.index('    private static func refineEdges(');b=s.index('    /// Justerer keyframes',a)
method=s[a:b].replace('private static func','static func',1)
test=r'''
let width=400,height=300
func intensity(_ x:Float,_ y:Float)->Float {
    let a=sin(x*0.117+y*0.027),b=sin(y*0.091-x*0.023)
    let c=sin(x*0.063+y*0.081)
    return 0.5+0.18*a+0.17*b+0.1*c
}
let shifts:[SIMD2<Float>]=[.zero,SIMD2(4,-3),SIMD2(-3,5)]
var frames=[Harness.Frame]()
for shift in shifts {
    var pixels=[Float]()
    for y in 0..<height { for x in 0..<width { pixels.append(intensity(Float(x)-shift.x,Float(y)-shift.y)) } }
    frames.append(Harness.Frame(w2c:matrix_identity_float4x4,camPos:.zero,fx:250,fy:250,cx:200,cy:150,luma:pixels,lw:width,lh:height,depth:[],dw:0,dh:0))
}
var points=[SIMD3<Float>](),normals=[SIMD3<Float>]()
for y in stride(from:25,to:275,by:7) { for x in stride(from:25,to:375,by:7) {
 points.append(SIMD3((Float(x)-200)/250*2,-(Float(y)-150)/250*2,-2));normals.append(SIMD3(0,0,1))
} }
let auditURL=URL(fileURLWithPath:NSTemporaryDirectory()).appendingPathComponent("edge-audit-"+UUID().uuidString+".json")
defer { try? FileManager.default.removeItem(at:auditURL) }
let offsets=Harness.refineEdges(frames:frames,points:points,normals:normals,diagnosticsURL:auditURL,overlapNeighbors:true)
let audit=try! JSONSerialization.jsonObject(with:Data(contentsOf:auditURL)) as! [String:Any]
let matches=audit["matches"] as! [[String:Any]]
precondition(!matches.isEmpty && matches.allSatisfy { ($0["uvR"] as? [Double])?.count == 2 },"Missing spatial diagnostics")
precondition((audit["accepted"] as? Bool) == true,"Known shifts were not accepted")
precondition(offsets.count==3,"Registration rejected known translation")
for i in 1..<3 {
 let relative=offsets[i]-offsets[0]
 print("shift",i,relative,"expected",shifts[i])
 precondition(simd_length(relative-shifts[i])<1.2,"Wrong relative offset")
}
// Larger displacements exceed the old search radius; use asymmetric texture.
let wideShifts:[SIMD2<Float>] = [.zero,SIMD2(24,-18),SIMD2(-20,15)]
var wide=frames
for i in wide.indices {
    wide[i].luma=[]
    for y in 0..<height { for x in 0..<width {
        wide[i].luma.append(intensity(Float(x)-wideShifts[i].x,Float(y)-wideShifts[i].y))
    } }
}
let wideOffsets=Harness.refineEdges(frames:wide,points:points,normals:normals,overlapNeighbors:true,widePatches:true,contextPatches:true)
precondition(wideOffsets.count==3,"Wide registration rejected known shifts")
for i in 1..<3 {
    print("wide shift",i,wideOffsets[i]-wideOffsets[0],"expected",wideShifts[i])
    precondition(simd_length(wideOffsets[i]-wideOffsets[0]-wideShifts[i])<1.2,"Wrong wide shift")
}
var periodic=frames
for i in periodic.indices {
    periodic[i].luma=[]
    for _ in 0..<height { for x in 0..<width {
        periodic[i].luma.append(0.5+0.2*sin((Float(x)-Float(i*4))*Float.pi/8))
    } }
}
precondition(Harness.refineEdges(frames:periodic,points:points,normals:normals,overlapNeighbors:true,widePatches:true,contextPatches:true).isEmpty,"Ambiguous repeated stripes must be rejected")
var noisyPeriodic=periodic
for i in noisyPeriodic.indices {
    for y in 0..<height { for x in 0..<width {
        noisyPeriodic[i].luma[y*width+x] += 0.05*sin(Float(x)*1.37+Float(y)*0.97+Float(i)*2.1)
    } }
}
let noisyResult=Harness.refineEdges(frames:noisyPeriodic,points:points,normals:normals,overlapNeighbors:true,widePatches:true,contextPatches:true)
precondition(noisyResult.isEmpty,"Repeated stripes with phase-varying noise must be rejected")
var flat=frames
for i in flat.indices { flat[i].luma=Array(repeating:0.5,count:width*height) }
precondition(Harness.refineEdges(frames:flat,points:points,normals:normals).isEmpty,"Textureless views must not drift")
print("OK: known image shifts recovered; textureless input rejected")
'''
with tempfile.TemporaryDirectory(prefix='ampex-native-edge-') as d:
 p=Path(d)/'main.swift';p.write_text('import Foundation\nimport simd\nimport Darwin\nsetbuf(stdout,nil)\nenum MeshLog {static func log(_ s:String){print(s)}}\nenum Harness {\n'+frame+'\n'+method+'\n}\n'+test)
 subprocess.run(['swiftc','-O','-module-cache-path',d+'/cache',str(p),'-o',d+'/verify'],check=True)
 subprocess.run([d+'/verify'],check=True)
