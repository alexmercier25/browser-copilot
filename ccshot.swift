// ccshot : capture la fenêtre d'une app (ou un écran) via ScreenCaptureKit.
// Empaqueté en app (~/Applications/CC Shot.app) et lancé via open(1) pour que
// la permission Enregistrement de l'écran lui soit attribuée à ELLE, pas à
// l'app hôte du shell. Résultat communiqué par <out>.status (open détache).
import Foundation
import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// SCContentFilter appelle SkyLight (SLSGetDisplaysWithRect), qui exige une
// connexion au window server. Sans ça: assert CGS_REQUIRE_INIT -> abort.
_ = NSApplication.shared

var appName = "Dia"
var outPath = "/tmp/ccshot.png"
var mode = "window"

var args = Array(CommandLine.arguments.dropFirst())
var i = 0
while i < args.count {
  switch args[i] {
  case "--app": i += 1; if i < args.count { appName = args[i] }
  case "--out": i += 1; if i < args.count { outPath = args[i] }
  case "--display": mode = "display"
  case "--list": mode = "list"
  default: break
  }
  i += 1
}

let statusPath = outPath + ".status"
func writeStatus(_ s: String) { try? s.write(toFile: statusPath, atomically: true, encoding: .utf8) }

func writePNG(_ image: CGImage, to path: String) -> Bool {
  guard let dest = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil
  ) else { return false }
  CGImageDestinationAddImage(dest, image, nil)
  return CGImageDestinationFinalize(dest)
}

Task {
  do {
    // Le prompt macOS n'offre pas de bouton « Autoriser » : l'app doit être
    // cochée à la main dans les Réglages. Or la ligne n'apparaît dans la liste
    // que tant que le process est VIVANT. Un helper qui demande puis quitte
    // aussitôt ne laisse rien à cocher. On reste donc en vie et on attend.
    if !CGPreflightScreenCaptureAccess() {
      writeStatus("WAITING: coche « CC Shot » dans Réglages > Confidentialité > Enregistrement de l'écran")
      CGRequestScreenCaptureAccess()
      var waited = 0.0
      while !CGPreflightScreenCaptureAccess() && waited < 180 {
        try await Task.sleep(nanoseconds: 500_000_000)
        waited += 0.5
      }
      if !CGPreflightScreenCaptureAccess() {
        writeStatus("ERROR: permission jamais accordee apres 180s")
        exit(5)
      }
      // tccd vient de basculer : laisser ScreenCaptureKit rattraper l'état.
      try await Task.sleep(nanoseconds: 1_500_000_000)
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

    if mode == "list" {
      var lines: [String] = []
      for w in content.windows where w.windowLayer == 0 {
        let app = w.owningApplication?.applicationName ?? "?"
        lines.append("\(app) | \(w.title ?? "") | \(Int(w.frame.width))x\(Int(w.frame.height))")
      }
      writeStatus("LIST\n" + lines.joined(separator: "\n"))
      exit(0)
    }

    let config = SCStreamConfiguration()
    config.showsCursor = false
    let image: CGImage

    if mode == "window" {
      let needle = appName.lowercased()
      let candidates = content.windows.filter { w in
        guard let app = w.owningApplication else { return false }
        return (app.applicationName.lowercased().contains(needle)
                || app.bundleIdentifier.lowercased().contains(needle))
          && w.windowLayer == 0 && w.frame.width > 300 && w.frame.height > 200
      }
      guard let win = candidates.max(by: {
        $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height
      }) else {
        writeStatus("ERROR: aucune fenetre trouvee pour \(appName)")
        exit(3)
      }
      config.width = Int(win.frame.width) * 2
      config.height = Int(win.frame.height) * 2
      let filter = SCContentFilter(desktopIndependentWindow: win)
      image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    } else {
      guard let display = content.displays.first else {
        writeStatus("ERROR: aucun ecran")
        exit(3)
      }
      config.width = display.width * 2
      config.height = display.height * 2
      let filter = SCContentFilter(display: display, excludingWindows: [])
      image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    if writePNG(image, to: outPath) {
      writeStatus("OK \(image.width)x\(image.height)")
      exit(0)
    } else {
      writeStatus("ERROR: ecriture PNG impossible")
      exit(4)
    }
  } catch {
    writeStatus("ERROR: \(error.localizedDescription)")
    exit(2)
  }
}
RunLoop.main.run()
