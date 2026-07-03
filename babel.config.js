module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [require('babel-preset-expo'), { jsxImportSource: 'nativewind' }],
    ],
    overrides: [
      {
        // WatermelonDB models: legacy decorators + loose class fields.
        // KUN vår kode — loose-semantikk på node_modules knekker React Native-kjernen
        // ("Cannot assign to read-only property 'NONE'").
        exclude: filename => !!filename && filename.includes('node_modules'),
        plugins: [
          ['@babel/plugin-proposal-decorators', { version: 'legacy' }],
          ['@babel/plugin-transform-class-properties', { loose: true }],
          ['@babel/plugin-transform-private-methods', { loose: true }],
          ['@babel/plugin-transform-private-property-in-object', { loose: true }],
        ],
      },
    ],
  }
}
