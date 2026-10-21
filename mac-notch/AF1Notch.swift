// AF1 Notch — drop images on the MacBook notch, they go to the staging media
// library through Ktulu (Asset Uploader rules: WebP, name, folder, content tags).
//
// Collapsed it is a small black shape around the notch; it opens when you hover
// it or drag files onto it. Images are made WebP on this Mac (cwebp from
// Homebrew), the name follows audif1_{year}_{LOC}_GP_{context}_{descriptor}_{nn}
// and the number is set by Ktulu per folder. Auth: the personal plugin token
// from Ktulu (Team Cards → Figma Sync → Setup).
//
// Build: mac-notch/build.sh (swiftc, no Xcode needed). Unsigned, for one Mac.

import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

let BASE = "https://af1-ktulu.vercel.app"
let LAVA = Color(red: 1, green: 0.176, blue: 0)
let LAVA_STRONG = Color(red: 0.85, green: 0.15, blue: 0)
let MUTED = Color(red: 0.64, green: 0.65, blue: 0.67)
let SURFACE = Color(red: 0.118, green: 0.125, blue: 0.133)
let CWEBP = ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp"].first { FileManager.default.isExecutableFile(atPath: $0) }

// ---- data from Ktulu ---------------------------------------------------------
struct Session: Codable, Hashable { let id: String; let name: String; let folderPath: String }
struct Race: Codable, Hashable, Identifiable {
  let round: Int; let label: String; let country: String; let city: String
  let start: String?; let end: String?; let loc: String; let year: Int
  let folderId: String?; let folderPath: String?; let sessions: [Session]
  var id: Int { round }
}
struct Setup: Codable { let user: String; let races: [Race]; let tags: [String]; let contexts: [String]; let altMax: Int }

enum Status: Equatable { case ready, working, done(String), failed(String) }

final class Item: ObservableObject, Identifiable {
  let id = UUID()
  let url: URL
  let thumb: NSImage?
  @Published var descriptor: String
  @Published var context = ""
  @Published var alt = ""
  @Published var tags: Set<String> = []
  @Published var status: Status = .ready
  init(url: URL) {
    self.url = url
    thumb = Item.thumbnail(url)
    // camera names (IMG_1234, DSC01234) say nothing: no descriptor from them
    let base = url.deletingPathExtension().lastPathComponent
    descriptor = base.range(of: #"^(IMG|DSC|DSCF|_MG|P\d|GOPR|PXL)[_\-]?\d+"#, options: [.regularExpression, .caseInsensitive]) != nil ? "" : cleanDescriptor(base)
  }
  static func thumbnail(_ url: URL) -> NSImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 160] as CFDictionary)
    else { return nil }
    return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
  }
}

func cleanDescriptor(_ s: String) -> String {
  let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).lowercased()
  let parts = folded.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).split(separator: "-").filter { !$0.isEmpty && !$0.allSatisfy(\.isNumber) }
  return parts.prefix(6).joined(separator: "-")
}

// ---- model ---------------------------------------------------------------------
@MainActor
final class Model: ObservableObject {
  @Published var token = UserDefaults.standard.string(forKey: "token") ?? ""
  @Published var setup: Setup?
  @Published var error: String?
  @Published var round: Int?
  @Published var folder: String = "" // session folder id, "" = the round folder
  @Published var items: [Item] = []
  @Published var expanded = false
  @Published var showSettings = false
  @Published var busy = false
  var onExpand: ((Bool) -> Void)?

  var race: Race? { setup?.races.first { $0.round == round } }

  func expand(_ on: Bool) {
    if expanded == on { return }
    expanded = on
    onExpand?(on)
  }

  func saveToken(_ t: String) {
    token = t.trimmingCharacters(in: .whitespacesAndNewlines)
    UserDefaults.standard.set(token, forKey: "token")
    Task { await load() }
  }

  func load() async {
    guard !token.isEmpty else { showSettings = true; return }
    do {
      let (data, res) = try await URLSession.shared.data(from: URL(string: "\(BASE)/api/notch/\(token)")!)
      if (res as? HTTPURLResponse)?.statusCode != 200 {
        error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Ktulu answered \((res as? HTTPURLResponse)?.statusCode ?? 0)"
        return
      }
      let s = try JSONDecoder().decode(Setup.self, from: data)
      setup = s
      error = nil
      if round == nil { round = Model.currentRace(s.races)?.round }
    } catch { self.error = "No connection to Ktulu: \(error.localizedDescription)" }
  }

  // the race weekend now, else the next one, else the last one
  static func currentRace(_ races: [Race]) -> Race? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime, .withDashSeparatorInDate, .withFractionalSeconds, .withTimeZone]
    let day = { (s: String?) -> Date? in s.flatMap { f.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } }
    let now = Date()
    if let on = races.first(where: { r in if let a = day(r.start), let b = day(r.end) { return a.addingTimeInterval(-3 * 86400) <= now && now <= b.addingTimeInterval(3 * 86400) }; return false }) { return on }
    if let next = races.first(where: { day($0.start).map { $0 > now } ?? false }) { return next }
    return races.last
  }

  func add(_ urls: [URL]) {
    let imgs = urls.filter { u in UTType(filenameExtension: u.pathExtension)?.conforms(to: .image) ?? false }
    for u in imgs where !items.contains(where: { $0.url == u }) {
      let it = Item(url: u)
      if let r = race { it.alt = "At the \(r.country) Grand Prix \(r.year)" }
      items.append(it)
    }
  }

  func name(for it: Item) -> String {
    guard let r = race else { return "Pick the Grand Prix" }
    var p = ["audif1", String(r.year), r.loc.uppercased(), "GP"]
    if !it.context.isEmpty { p.append(it.context) }
    let d = cleanDescriptor(it.descriptor)
    if !d.isEmpty { p.append(d) }
    p.append("NN")
    return p.joined(separator: "_") + ".webp"
  }

  func uploadAll() async {
    guard let r = race else { error = "Pick the Grand Prix first"; return }
    guard CWEBP != nil else { error = "WebP encoder missing: run `brew install webp` once"; return }
    busy = true
    defer { busy = false }
    for it in items where it.status != .working && !isDone(it) {
      if it.alt.trimmingCharacters(in: .whitespaces).isEmpty { it.status = .failed("Alt text missing"); continue }
      it.status = .working
      do {
        let webp = try await Task.detached { try encodeWebP(it.url) }.value
        var req = URLRequest(url: URL(string: "\(BASE)/api/notch/\(token)")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["action": "upload", "data": webp.base64EncodedString(), "round": r.round, "folder": folder.isEmpty ? (r.folderId ?? "") : folder, "context": it.context, "descriptor": it.descriptor, "alt": it.alt, "tags": Array(it.tags)]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 90
        let (data, _) = try await URLSession.shared.data(for: req)
        let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let fn = j["filename"] as? String { it.status = .done(fn) } else { it.status = .failed(j["error"] as? String ?? "Upload failed") }
      } catch { it.status = .failed(error.localizedDescription) }
    }
  }
  func isDone(_ it: Item) -> Bool { if case .done = it.status { return true }; return false }
  func clearDone() { items.removeAll { isDone($0) } }
}

// WebP on this Mac: the image turned upright and scaled to 2400 px on the long side (ImageIO), then cwebp
func encodeWebP(_ url: URL) throws -> Data {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2400] as CFDictionary)
  else { throw NSError(domain: "af1", code: 1, userInfo: [NSLocalizedDescriptionKey: "Can't read the image"]) }
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("af1-notch-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: dir) }
  let png = dir.appendingPathComponent("in.png"), out = dir.appendingPathComponent("out.webp")
  guard let d = CGImageDestinationCreateWithURL(png as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw NSError(domain: "af1", code: 2) }
  CGImageDestinationAddImage(d, cg, nil)
  CGImageDestinationFinalize(d)
  let p = Process()
  p.executableURL = URL(fileURLWithPath: CWEBP!)
  p.arguments = ["-quiet", "-q", "85", "-metadata", "none", png.path, "-o", out.path]
  try p.run()
  p.waitUntilExit()
  guard p.terminationStatus == 0 else { throw NSError(domain: "af1", code: 3, userInfo: [NSLocalizedDescriptionKey: "WebP encoding failed"]) }
  return try Data(contentsOf: out)
}

// ---- views ---------------------------------------------------------------------
struct NotchView: View {
  @ObservedObject var m: Model
  @State private var dropHover = false
  let notch: CGSize

  var body: some View {
    ZStack(alignment: .top) {
      if m.expanded {
        Expanded(m: m)
          .frame(width: 640, height: 470)
          .background(UnevenRoundedRectangle(bottomLeadingRadius: 22, bottomTrailingRadius: 22).fill(Color.black))
          .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
      } else {
        UnevenRoundedRectangle(bottomLeadingRadius: 10, bottomTrailingRadius: 10)
          .fill(Color.black)
          .frame(width: notch.width + (m.items.isEmpty ? 0 : 56), height: notch.height)
          .overlay(alignment: .trailing) {
            if !m.items.isEmpty {
              Text("\(m.items.count)").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(LAVA_STRONG)).padding(.trailing, 10)
            }
          }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .onHover { h in if h { withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) { m.expand(true) } } else if m.items.isEmpty && !m.showSettings { withAnimation(.easeIn(duration: 0.18)) { m.expand(false) } } }
    .onDrop(of: [.fileURL], isTargeted: Binding(get: { dropHover }, set: { v in dropHover = v; if v { withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) { m.expand(true) } } })) { providers in
      for p in providers {
        _ = p.loadObject(ofClass: URL.self) { url, _ in if let url { DispatchQueue.main.async { m.add([url]) } } }
      }
      return true
    }
  }
}

struct Expanded: View {
  @ObservedObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        Text("AF1 Notch").font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
        Text("Staging media").font(.system(size: 12)).foregroundColor(MUTED)
        Spacer()
        Button { m.showSettings.toggle() } label: { Image(systemName: "gearshape") }.buttonStyle(.plain).foregroundColor(MUTED).help("Token")
        Button { withAnimation { m.expand(false) } } label: { Image(systemName: "chevron.up") }.buttonStyle(.plain).foregroundColor(MUTED).help("Close")
      }
      .padding(.top, 38)
      if m.showSettings || m.token.isEmpty { Settings(m: m) }
      else if let e = m.error, m.setup == nil { Text(e).font(.system(size: 13)).foregroundColor(Color(red: 1, green: 0.6, blue: 0.52)) }
      else if let s = m.setup {
        HStack(spacing: 10) {
          Picker("", selection: Binding(get: { m.round ?? 0 }, set: { m.round = $0; m.folder = "" })) {
            ForEach(s.races) { r in Text(r.label).tag(r.round) }
          }.labelsHidden().frame(width: 280)
          Picker("", selection: $m.folder) {
            Text(m.race?.folderPath.map { "Folder: \($0.replacingOccurrences(of: "10_Media-Galleries/", with: ""))" } ?? "No folder yet").tag("")
            ForEach(m.race?.sessions ?? [], id: \.id) { se in Text(se.name).tag(se.id) }
          }.labelsHidden().frame(width: 220)
          Spacer()
        }
        if m.items.isEmpty {
          VStack(spacing: 8) {
            Image(systemName: "photo.on.rectangle.angled").font(.system(size: 30)).foregroundColor(MUTED)
            Text("Drop images here").font(.system(size: 15, weight: .medium)).foregroundColor(.white)
            Text("They become WebP, get their name by the rule and go to the folder above.").font(.system(size: 12)).foregroundColor(MUTED)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6, 5])).foregroundColor(Color.white.opacity(0.25)))
        } else {
          ScrollView { VStack(spacing: 8) { ForEach(m.items) { it in Row(m: m, it: it, tags: s.tags, contexts: s.contexts) } } }
          HStack(spacing: 10) {
            if let e = m.error { Text(e).font(.system(size: 12)).foregroundColor(Color(red: 1, green: 0.6, blue: 0.52)) }
            Spacer()
            Button("Clear done") { m.clearDone() }.buttonStyle(.plain).foregroundColor(MUTED).font(.system(size: 12))
            Button("Open in Ktulu") { NSWorkspace.shared.open(URL(string: "\(BASE)/assets")!) }.buttonStyle(.plain).foregroundColor(MUTED).font(.system(size: 12))
            Button { Task { await m.uploadAll() } } label: {
              Text(m.busy ? "Uploading …" : "Upload \(m.items.filter { !m.isDone($0) }.count)").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 7).background(Capsule().fill(LAVA_STRONG))
            }.buttonStyle(.plain).disabled(m.busy || m.items.allSatisfy { m.isDone($0) })
          }
        }
      } else { ProgressView().controlSize(.small).frame(maxWidth: .infinity) }
    }
    .padding(.horizontal, 20).padding(.bottom, 16)
    .preferredColorScheme(.dark)
  }
}

struct Row: View {
  @ObservedObject var m: Model
  @ObservedObject var it: Item
  let tags: [String]
  let contexts: [String]
  @State private var tagQuery = ""
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Group {
        if let t = it.thumb { Image(nsImage: t).resizable().aspectRatio(contentMode: .fill) } else { SURFACE }
      }.frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 6) {
        Text(m.name(for: it)).font(.system(size: 12, design: .monospaced)).foregroundColor(.white).lineLimit(1).truncationMode(.middle)
        HStack(spacing: 6) {
          TextField("descriptor, e.g. paddock-walk", text: $it.descriptor).textFieldStyle(.roundedBorder).font(.system(size: 12))
          Picker("", selection: $it.context) { Text("no context").tag(""); ForEach(contexts, id: \.self) { Text($0).tag($0) } }.labelsHidden().frame(width: 120)
        }
        TextField("Alt text (English)", text: $it.alt).textFieldStyle(.roundedBorder).font(.system(size: 12))
        HStack(spacing: 6) {
          ForEach(Array(it.tags).sorted(), id: \.self) { t in
            Button { it.tags.remove(t) } label: { Text("\(t) ×").font(.system(size: 12)).foregroundColor(.white).padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(Color.white.opacity(0.14))) }.buttonStyle(.plain)
          }
          Menu("+ Tag") {
            ForEach(tags.filter { !it.tags.contains($0) }.prefix(60), id: \.self) { t in Button(t) { it.tags.insert(t) } }
          }.menuStyle(.borderlessButton).fixedSize().font(.system(size: 12))
          Spacer()
          switch it.status {
          case .ready: EmptyView()
          case .working: ProgressView().controlSize(.small)
          case .done: Label("Uploaded", systemImage: "checkmark.circle.fill").font(.system(size: 12)).foregroundColor(Color(red: 0.44, green: 0.81, blue: 0.49))
          case .failed(let e): Text(e).font(.system(size: 12)).foregroundColor(Color(red: 1, green: 0.6, blue: 0.52)).lineLimit(2)
          }
        }
      }
      Button { m.items.removeAll { $0.id == it.id } } label: { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundColor(MUTED)
    }
    .padding(10)
    .background(RoundedRectangle(cornerRadius: 12).fill(SURFACE))
  }
}

struct Settings: View {
  @ObservedObject var m: Model
  @State private var t = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your Ktulu token").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
      Text("The same token as for the Figma plugin: Ktulu → Team Cards → Figma Sync → Setup → Create plugin token.").font(.system(size: 12)).foregroundColor(MUTED)
      HStack {
        SecureField("Paste the token", text: $t).textFieldStyle(.roundedBorder)
        Button("Save") { m.saveToken(t); m.showSettings = false }.disabled(t.trimmingCharacters(in: .whitespaces).isEmpty)
        Button("Get a token") { NSWorkspace.shared.open(URL(string: "\(BASE)/teamcards/figma?tab=setup")!) }
      }
      if let e = m.error { Text(e).font(.system(size: 12)).foregroundColor(Color(red: 1, green: 0.6, blue: 0.52)) }
      if CWEBP == nil { Text("WebP encoder missing: run `brew install webp` in Terminal once.").font(.system(size: 12)).foregroundColor(Color(red: 1, green: 0.6, blue: 0.52)) }
    }
  }
}

// ---- window at the notch -------------------------------------------------------
final class NotchPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  var panel: NotchPanel!
  var status: NSStatusItem!
  let model = Model()

  func applicationDidFinishLaunching(_ n: Notification) {
    let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!
    var notch = CGSize(width: 200, height: 32)
    if let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea { notch = CGSize(width: screen.frame.width - l.width - r.width, height: screen.safeAreaInsets.top) }
    let size = CGSize(width: 680, height: 480)
    let frame = NSRect(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height, width: size.width, height: size.height)
    panel = NotchPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.isMovable = false
    let host = NSHostingView(rootView: NotchView(m: model, notch: notch))
    host.frame = NSRect(origin: .zero, size: size)
    panel.contentView = host
    // only the notch shape takes the mouse while collapsed; the rest of the panel lets clicks through
    let collapsedRect = NSRect(x: frame.midX - notch.width / 2 - 30, y: frame.maxY - notch.height, width: notch.width + 60, height: notch.height)
    panel.ignoresMouseEvents = false
    let tracker = NSTrackingArea(rect: host.bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
    host.addTrackingArea(tracker)
    self.collapsed = collapsedRect
    model.onExpand = { [weak self] on in
      guard let self else { return }
      if on { NSApp.activate(ignoringOtherApps: true); self.panel.makeKey() }
      self.updateClickThrough()
    }
    panel.orderFrontRegardless()
    updateClickThrough()
    Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in Task { @MainActor in self?.updateClickThrough() } }

    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.title = "AF1"
    let menu = NSMenu()
    menu.addItem(withTitle: "Open", action: #selector(openPanel), keyEquivalent: "o")
    menu.addItem(withTitle: "Token …", action: #selector(openSettings), keyEquivalent: ",")
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit AF1 Notch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.items.forEach { $0.target = $0.action == #selector(NSApplication.terminate(_:)) ? nil : self }
    status.menu = menu
    Task { await model.load() }
  }
  var collapsed = NSRect.zero

  // click-through outside the notch while collapsed, so the menu bar under the panel keeps working;
  // a drag of files near the notch still reaches it
  func updateClickThrough() {
    let mouse = NSEvent.mouseLocation
    let near = collapsed.insetBy(dx: -20, dy: -12).contains(mouse)
    panel.ignoresMouseEvents = !(model.expanded || near)
  }

  @objc func openPanel() { withAnimation { model.expand(true) } }
  @objc func openSettings() { model.showSettings = true; withAnimation { model.expand(true) } }
}

@main
struct Main {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }
}
