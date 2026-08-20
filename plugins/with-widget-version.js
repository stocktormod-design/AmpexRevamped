const { withXcodeProject } = require('expo/config-plugins')

/**
 * Setter MARKETING_VERSION på ALLE mål til appens `version` fra app.json.
 *
 * expo-widgets lager widget-målet med MARKETING_VERSION = 1.0 hardkodet, mens
 * appen får `version` fra app.json (1.0.0). Xcode advarer:
 *
 *   The CFBundleShortVersionString of an app extension ('1.0') must match that
 *   of its containing parent app ('1.0.0').
 *
 * Det er bare en advarsel i et utviklingsbygg, men **App Store Connect avviser
 * opplastingen** på nøyaktig denne regelen. Å oppdage det ved første innsending
 * er en dårlig dag; å rette det her koster ti linjer.
 *
 * Kan ikke rettes i ios/ direkte — mappa er gitignorert og genereres på nytt
 * ved hver `expo prebuild`.
 */
module.exports = function withWidgetVersion(config) {
  return withXcodeProject(config, mod => {
    const versjon = config.version ?? '1.0.0'
    const konfigurasjoner = mod.modResults.pbxXCBuildConfigurationSection()
    for (const nokkel of Object.keys(konfigurasjoner)) {
      const bygg = konfigurasjoner[nokkel]
      // Kommentarnøklene (`<id>_comment`) er strenger, ikke objekter.
      if (!bygg || typeof bygg !== 'object' || !bygg.buildSettings) continue
      // Bare mål som ALLEREDE har en marketing version — vi vil ikke innføre
      // innstillingen på Pods-mål som ikke bruker den.
      if (bygg.buildSettings.MARKETING_VERSION === undefined) continue
      bygg.buildSettings.MARKETING_VERSION = `"${versjon}"`
    }
    return mod
  })
}
