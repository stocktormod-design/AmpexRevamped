const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// 3D-bilmodellene på Meg-fanen (assets/bilmodeller/*.glb) bundles som assets.
config.resolver.assetExts.push('glb')

module.exports = withNativeWind(config, { input: './global.css' })
