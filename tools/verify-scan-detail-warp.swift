// Run: swift tools/verify-scan-detail-warp.swift
// Executes the production Metal UV helper. Requires a Mac with Metal.
import Foundation
import Metal
import simd

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = try String(contentsOf: root.appendingPathComponent("modules/ampex-splat/ios/MeshBakeV2.swift"), encoding: .utf8)
let start = source.range(of: "    float2 bakev2_detail_uv(")!.lowerBound
let end = source.range(of: "    // Diagnostic only: identical geometric/warp sampling", range: start..<source.endIndex)!.lowerBound
let helper = String(source[start..<end])
let shader = "#include <metal_stdlib>\nusing namespace metal;\n" + helper + """
kernel void check(constant float2* grid [[buffer(0)]], constant int2& dims [[buffer(1)]],
                  const device float2* inputs [[buffer(2)]], device float2* outputs [[buffer(3)]],
                  uint id [[thread_position_in_grid]]) {
    outputs[id] = bakev2_detail_uv(inputs[id], grid, dims);
}
"""
let device = MTLCreateSystemDefaultDevice()!
// Also compile the complete production shader, including both fragment entry points.
let metalStart = source.range(of: "private static let shaderSource = \"\"\"")!.upperBound
let metalEnd = source.range(of: "\"\"\"", range: metalStart..<source.endIndex)!.lowerBound
let production = try device.makeLibrary(source: String(source[metalStart..<metalEnd]), options: nil)
precondition(production.makeFunction(name: "bakev2_fragment") != nil)
precondition(production.makeFunction(name: "bakev2_feather_fragment") != nil)
let library = try device.makeLibrary(source: shader, options: nil)
let pipeline = try device.makeComputePipelineState(function: library.makeFunction(name: "check")!)
let queue = device.makeCommandQueue()!
let inputs: [SIMD2<Float>] = [.zero, SIMD2(0.2, 0.8), SIMD2(0.5, 0.5), SIMD2(1, 1)]
func run(_ grid: [SIMD2<Float>]) -> [SIMD2<Float>] {
    let output = device.makeBuffer(length: inputs.count * MemoryLayout<SIMD2<Float>>.stride, options: .storageModeShared)!
    let command = queue.makeCommandBuffer()!, encoder = command.makeComputeCommandEncoder()!
    encoder.setComputePipelineState(pipeline)
    var dims = SIMD2<Int32>(2, 2)
    grid.withUnsafeBytes { encoder.setBytes($0.baseAddress!, length: $0.count, index: 0) }
    encoder.setBytes(&dims, length: MemoryLayout<SIMD2<Int32>>.stride, index: 1)
    inputs.withUnsafeBytes { encoder.setBytes($0.baseAddress!, length: $0.count, index: 2) }
    encoder.setBuffer(output, offset: 0, index: 3)
    encoder.dispatchThreads(MTLSize(width: inputs.count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 4, height: 1, depth: 1))
    encoder.endEncoding(); command.commit(); command.waitUntilCompleted()
    precondition(command.status == .completed, "Metal execution failed")
    return Array(UnsafeBufferPointer(start: output.contents().assumingMemoryBound(to: SIMD2<Float>.self), count: inputs.count))
}
func close(_ actual: SIMD2<Float>, _ expected: SIMD2<Float>) { precondition(simd_length(actual - expected) < 1e-6, "\(actual) != \(expected)") }
let identity = run(Array(repeating: .zero, count: 4))
for i in inputs.indices { close(identity[i], inputs[i]) }
let shifted = run(Array(repeating: SIMD2(0.1, -0.2), count: 4))
close(shifted[0], SIMD2(0.1, 0)); close(shifted[1], SIMD2(0.3, 0.6))
close(shifted[3], SIMD2(1, 0.8))
let varying = run([.zero, SIMD2(0.2, 0), SIMD2(0, -0.2), SIMD2(0.2, -0.2)])
close(varying[2], SIMD2(0.6, 0.4))
print("OK: 8 assertions executing production Metal detail warp (identity, shift, interpolation, borders)")
