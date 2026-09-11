#!/usr/bin/env python3
"""Run actual face-scope Swift and Metal vertex/fragment paths on a small fixture.

Requires macOS/Metal. The two adjacent atlas patches sample the same photograph:
only the assigned wall may move, including when drawing its feather donor.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'modules/ampex-splat/ios/MeshBakeV2.swift').read_text()
start = source.index('    static func imageFieldApplies(')
end = source.index('\n    }', start) + 6
metal = source.split('private static let shaderSource = """', 1)[1].split('"""', 1)[0]
swift = r'''
import Foundation
import Metal
import simd
enum Bake {
__HELPER__
}
let n = SIMD3<Float>(0, 0, -1), plane = SIMD4<Float>(0, 0, -1, 2)
let wall = [SIMD3<Float>(0,0,-2), SIMD3(1,0,-2), SIMD3(0,1,-2)]
func applies(_ corners: [SIMD3<Float>], slot: Int32 = 0,
             normal: SIMD3<Float> = n, assignedNormal: SIMD3<Float> = n,
             assignedDistance: Float = 2) -> Bool {
    Bake.imageFieldApplies(plane: plane, assignedPlane: slot,
        planeNormals: [assignedNormal], planeDistances: [assignedDistance],
        normal: normal, corners: corners)
}
precondition(applies(wall), "The assigned coplanar wall must retain the measured registration")
precondition(!applies(wall,slot:-1), "Nearby furniture without wall assignment must not move")
precondition(!applies(wall,normal:SIMD3(0,1,0)), "A crossing furniture surface must not move")
precondition(!applies(wall,assignedNormal:SIMD3(1,0,0)), "Another wall must not inherit the field")
precondition(!applies(wall,assignedDistance:2.1), "A parallel distinct wall must not inherit the field")
let crossing = [SIMD3<Float>(0,0,-1.97), SIMD3(1,0,-2.03), SIMD3(0,1,-2)]
precondition(!applies(crossing), "A coplanar centroid cannot qualify protruding corners")
precondition(!applies([wall[0],wall[1],SIMD3(0,1,-2.011)]), "All three corners must be supported")
precondition(!applies([wall[0],wall[1],SIMD3(0,1,Float.nan)]), "Invalid geometry must fail closed")

let device = MTLCreateSystemDefaultDevice()!
let shader = try String(contentsOfFile: CommandLine.arguments[1], encoding:.utf8)
let library = try device.makeLibrary(source: shader, options:nil)
let queue = device.makeCommandQueue()!
// Execute the exact production vertex packing code, including slot9 and stride10.
let uv = UV(positions:[0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1],
    uvs:[0,0, 0.5,0, 0,1, 0.5,1], indices:[0,1,2, 1,3,2])
let winner: [Int32] = [0,0]
let cornerOfs = [SIMD3<Float>](repeating:.zero,count:6)
let fieldWarpFace = [true,false]
__PACKING__
// Each face gets a separate half-atlas patch to avoid shared pixels. Both see
// precisely the same source position, so any non-wall shift is a regression.
for j in 0..<3 { vdata[(3+j)*10+3] += 0.5 }
let vertexBuffer = device.makeBuffer(bytes:vdata,length:vdata.count*4)!
struct Cam { var w2c:simd_float4x4; var intr:SIMD4<Float>; var img:SIMD4<Float>
    var wb:SIMD4<Float>; var ofs:SIMD4<Float>; var camPos:SIMD4<Float> }
var cam = Cam(w2c:matrix_identity_float4x4,intr:SIMD4(1,1,0.5,0.5),img:SIMD4(1,1,0,0),
    wb:SIMD4(repeating:1),ofs:SIMD4(0,0,0,0.04),camPos:.zero)
var grid = [SIMD2<Float>](repeating:SIMD2(0.25,0),count:4)
var dims = SIMD2<Int32>(2,2)
let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba32Float,width:64,height:4,mipmapped:false)
td.usage = [.shaderRead]; td.storageMode = .shared
let photo = device.makeTexture(descriptor:td)!
let pixels = (0..<256).flatMap { i -> [Float] in [Float(i%64)/64+0.5/64,0.2,0.3,1] }
pixels.withUnsafeBytes { photo.replace(region:MTLRegionMake2D(0,0,64,4),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:64*16) }
func render(_ name:String) throws -> [Float] {
    let pd = MTLRenderPipelineDescriptor()
    pd.vertexFunction = library.makeFunction(name:"bakev2_vertex")!
    pd.fragmentFunction = library.makeFunction(name:name)!
    pd.colorAttachments[0].pixelFormat = .rgba32Float
    let pipeline = try device.makeRenderPipelineState(descriptor:pd)
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba32Float,width:32,height:16,mipmapped:false)
    desc.usage = [.renderTarget];desc.storageMode = .shared
    let result = device.makeTexture(descriptor:desc)!
    let pass = MTLRenderPassDescriptor();pass.colorAttachments[0].texture = result
    pass.colorAttachments[0].loadAction = .clear;pass.colorAttachments[0].storeAction = .store
    let cb = queue.makeCommandBuffer()!, enc = cb.makeRenderCommandEncoder(descriptor:pass)!
    enc.setRenderPipelineState(pipeline);enc.setVertexBuffer(vertexBuffer,offset:0,index:0)
    enc.setFragmentBytes(&cam,length:MemoryLayout<Cam>.stride,index:0)
    grid.withUnsafeBytes { enc.setFragmentBytes($0.baseAddress!,length:$0.count,index:1) }
    enc.setFragmentBytes(&dims,length:8,index:2);enc.setFragmentTexture(photo,index:0)
    enc.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:6)
    enc.endEncoding();cb.commit();cb.waitUntilCompleted()
    precondition(cb.status == .completed)
    var out = [Float](repeating:0,count:32*16*4)
    out.withUnsafeMutableBytes { result.getBytes($0.baseAddress!,bytesPerRow:32*16,from:MTLRegionMake2D(0,0,32,16),mipmapLevel:0) }
    return out
}
func near(_ a:Float,_ b:Float) { precondition(abs(a-b)<0.0001,"\(a) != \(b)") }
let raw = try render("bakev2_raw_fragment")
// Interior points in the two triangle patches, outside their diagonal edges.
let left = (2*32+2)*4, right = (12*32+29)*4
near(raw[left],0.75);near(raw[right],0.5)
let detailed = try render("bakev2_fragment")
near(detailed[left],0.75*(1+0.15*0.25*0.25*4));near(detailed[right],0.5)
let feather = try render("bakev2_feather_fragment")
near(feather[left],detailed[left]*0.5);near(feather[right],detailed[right]*0.5)
print("OK: 8 wall-scope contracts; actual slot9 vertex packing and raw/detail/feather Metal renders preserve excluded geometry")
struct UV { var positions:[Float];var uvs:[Float];var indices:[UInt32] }
'''
packing_start = source.index('        let triCount = winner.count', source.index('private static func rasterize('))
packing_end = source.index('        // Slot 8:', packing_start)
swift = swift.replace('__HELPER__', source[start:end]).replace('__PACKING__', source[packing_start:packing_end])
with tempfile.TemporaryDirectory(prefix='ampex-plane-warp-') as d:
    path = Path(d)
    (path/'main.swift').write_text(swift)
    (path/'bake.metal').write_text(metal)
    subprocess.run(['swift','-module-cache-path',d+'/cache',str(path/'main.swift'),str(path/'bake.metal')],check=True)
