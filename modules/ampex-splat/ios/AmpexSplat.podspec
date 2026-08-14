require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AmpexSplat'
  s.version        = package['version']
  s.summary        = 'Teksturert LiDAR-mesh-skanning og -visning'
  s.description    = 'ARKit scene reconstruction → MeshBakeV2 (pose-refine + per-face vinnervalg + plan-lås + multiband) → xatlas UV-unwrap → teksturert GLB. Kun enhets-arkitektur, ikke simulator.'
  s.author         = 'Ampex'
  s.homepage       = 'https://ampex.no'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Mesh-vieweren parser GLB selv (AmpexGlbLoader) — GLTFKit2 fins ikke på CocoaPods.

  s.resources = ['vendor/coverage.metallib']
  # CoverageMesh.metal er kilden til coverage.metallib (prekompilert — scn_metal
  # kan ikke kompileres runtime); .metal-fila skal IKKE med i source_files.
  s.exclude_files = 'CoverageMesh.metal'

  # Swift: Expo-modulen + juni-mesh-pipelinen (+ xatlas C++)
  s.source_files = '*.{swift,h,cpp}'
  # Offentlig C-header → synlig for podens Swift via umbrella (ingen bridging header i pods)
  s.public_header_files = 'xatlas_wrap.h'

  s.frameworks = 'Metal', 'MetalKit', 'MetalPerformanceShaders', 'Foundation', 'ImageIO', 'CoreGraphics', 'ARKit', 'SceneKit', 'UIKit', 'CoreImage'
  s.libraries  = 'c++'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'OTHER_LDFLAGS' => '-lc++'
  }
end
