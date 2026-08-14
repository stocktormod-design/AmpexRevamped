const { withEntitlementsPlist } = require('expo/config-plugins')

// expo-widgets' plugin skriver aps-environment (push) UBETINGET — se
// node_modules/expo-widgets/plugin/build/ios/withIosWidgets.js (withPushNotifications
// kjøres alltid; enablePushNotifications styrer kun et Info.plist-flagg). Gratis
// personlige Apple-team kan ikke signere med push-entitlement, og våre Live
// Activities oppdateres fra appen (ikke via APNs), så entitlementen er ren støy.
// MÅ ligge FØRST i app.json sin plugin-liste: entitlements-mods kjøres i OMVENDT
// listerekkefølge, så først-i-listen = sist-kjørt = vinner over expo-widgets.
module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, mod => {
    delete mod.modResults['aps-environment']
    return mod
  })
}
