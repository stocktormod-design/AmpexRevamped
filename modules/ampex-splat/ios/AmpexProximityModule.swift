import ExpoModulesCore
import UIKit

/// Nærhetssensoren (samme som slukker skjermen under telefonsamtaler) — brukes til
/// «løft til øret»-aktivering av AI-assistenten (lib/ai/raise-listener.ts): dekket
/// sensor + oppreist telefon = brukeren holder den mot øret som en samtale.
/// NB: aktivert overvåkning betyr at iOS slukker skjermen når sensoren dekkes —
/// ønsket her, det ER telefonsamtale-følelsen. Slås av når appen bakgrunnes.
public final class AmpexProximityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AmpexProximity")

    Events("onProximity")

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        UIDevice.current.isProximityMonitoringEnabled = enabled
      }
    }

    OnStartObserving {
      DispatchQueue.main.async {
        NotificationCenter.default.addObserver(
          forName: UIDevice.proximityStateDidChangeNotification,
          object: nil,
          queue: .main
        ) { [weak self] _ in
          self?.sendEvent("onProximity", ["near": UIDevice.current.proximityState])
        }
      }
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(self, name: UIDevice.proximityStateDidChangeNotification, object: nil)
    }

    OnDestroy {
      DispatchQueue.main.async {
        UIDevice.current.isProximityMonitoringEnabled = false
      }
    }
  }
}
