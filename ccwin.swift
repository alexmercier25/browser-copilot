// Liste les IDs de fenêtres. CGWindowListCopyWindowInfo donne numéro, owner et
// bounds SANS permission Enregistrement de l'écran (seuls les titres l'exigent).
import Foundation
import CoreGraphics

let needle = CommandLine.arguments.count > 1 ? CommandLine.arguments[1].lowercased() : ""
guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
  exit(1)
}
var best: (id: Int, area: Double)? = nil
for w in list {
  guard let owner = w[kCGWindowOwnerName as String] as? String,
        let num = w[kCGWindowNumber as String] as? Int,
        let layer = w[kCGWindowLayer as String] as? Int,
        let b = w[kCGWindowBounds as String] as? [String: Any],
        let width = b["Width"] as? Double, let height = b["Height"] as? Double
  else { continue }
  if layer != 0 || width < 300 || height < 200 { continue }
  if needle.isEmpty {
    print("\(num)\t\(owner)\t\(Int(width))x\(Int(height))")
  } else if owner.lowercased().contains(needle) {
    let area = width * height
    if best == nil || area > best!.area { best = (num, area) }
  }
}
if !needle.isEmpty {
  if let b = best { print(b.id) } else { exit(3) }
}
