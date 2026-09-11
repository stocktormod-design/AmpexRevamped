#!/usr/bin/env python3
"""Verify production Metal fusion and Surface Nets with known multiview planes.
Requires a Metal device; includes volume blur, excludes mesh smoothing and snapping.
"""
from pathlib import Path
import subprocess
import tempfile
s=(Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshTsdfBuild.swift').read_text()
msl=s.split('private static let integrateMSL = """',1)[1].split('"""',1)[0]
a=s.index('    private struct GPUParams');b=s.index('\n    }',a)+6;params=s[a:b].replace('private struct','struct')
a=s.index('        var cell =',s.index('private static func surfaceNets'));b=s.index('        guard !verts.isEmpty',a);body=s[a:b]
a=s.index('    private static func blurVolume(');b=s.index('\n    }',a)+6
blur=s[a:b].replace('private static func','func')
h='''import Foundation
import Metal
import simd
'''+params+'\nlet msl = """\n'+msl+'\n"""\n'+'''func extract(sdf: UnsafeMutablePointer<Float>, wgt: UnsafeMutablePointer<Float>,dim: SIMD3<Int>,lo: SIMD3<Float>,vox: Float,minW:Float)->[SIMD3<Float>] {
'''+body+'\nreturn verts\n}\n'+blur+'\n'
h+='''
let device=MTLCreateSystemDefaultDevice()!
let queue=device.makeCommandQueue()!
let library=try device.makeLibrary(source:msl,options:nil)
let pipeline=try device.makeComputePipelineState(function:library.makeFunction(name:"ampex_integrate")!)
let dim=SIMD3<Int>(20,20,24), lo=SIMD3<Float>(-0.2,-0.2,-1.74), vox:Float=0.02
let count=dim.x*dim.y*dim.z
for n in [SIMD3<Float>(0,0,1),simd_normalize(SIMD3<Float>(0.3,0.2,1))] {
 let planeD:Float = -1.5*n.z
 let sum=device.makeBuffer(length:count*4,options:.storageModeShared)!
 let weight=device.makeBuffer(length:count*4,options:.storageModeShared)!
 memset(sum.contents(),0,count*4);memset(weight.contents(),0,count*4)
 for i in 0..<8 {
  let camera=SIMD3<Float>(Float(i-4)*0.025,0,0)
  var depth=[Float]()
  for y in 0..<144 {for x in 0..<256 {
   let ray=SIMD3<Float>((Float(x)-128)/180,-(Float(y)-72)/180,-1)
   depth.append((planeD-simd_dot(n,camera))/simd_dot(n,ray))
  }}
  let buffer=device.makeBuffer(bytes:depth,length:depth.count*4,options:.storageModeShared)!
  var tf=matrix_identity_float4x4;tf.columns.3=SIMD4<Float>(-camera,1)
  var p=GPUParams(w2c:tf,lo:lo,voxel:vox,dims:SIMD3<Int32>(20,20,24),trunc:0.064,truncBehind:0.064,fx:180,fy:180,cx:128,cy:72,dw:256,dh:144,wf0:1,edgeRadius:1,jbuScale:1,p0:0,p1:0)
  let command=queue.makeCommandBuffer()!;let encoder=command.makeComputeCommandEncoder()!
  encoder.setComputePipelineState(pipeline)
  encoder.setBuffer(sum,offset:0,index:0);encoder.setBuffer(weight,offset:0,index:1);encoder.setBuffer(buffer,offset:0,index:2)
  encoder.setBytes(&p,length:MemoryLayout<GPUParams>.stride,index:3)
  encoder.dispatchThreads(MTLSize(width:20,height:20,depth:24),threadsPerThreadgroup:MTLSize(width:8,height:8,depth:4));encoder.endEncoding()
  command.commit();command.waitUntilCompleted()
  guard command.status == .completed else {fatalError("GPU command failed")}
 }
 let s=sum.contents().bindMemory(to:Float.self,capacity:count),w=weight.contents().bindMemory(to:Float.self,capacity:count)
 for i in 0..<count {if w[i]>0 {s[i]/=w[i]}}
 for pass in 0...1 {
 if pass == 1 {blurVolume(s,wgt:w,count:count,dim:dim,passes:1,minW:4)}
 let vertices=extract(sdf:s,wgt:w,dim:dim,lo:lo,vox:vox,minW:4)
 guard !vertices.isEmpty else {fatalError("No plane")}
 let errors=vertices.map {simd_dot(n,$0)-planeD}.sorted()
 let maxError=errors.map {abs($0)}.max()!
 print("blur",pass,"normal",n,"vertices",vertices.count,"signed median mm",errors[errors.count/2]*1000,"max mm",maxError*1000)
 guard maxError<0.004 else {fatalError("Plane displaced over 4mm")}
 }
}
'''
with tempfile.TemporaryDirectory(prefix='ampex-gpu-plane-') as folder:
    source=Path(folder)/'main.swift';binary=Path(folder)/'verify';source.write_text(h)
    subprocess.run(['swiftc','-module-cache-path',folder+'/cache',str(source),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
