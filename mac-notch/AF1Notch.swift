// AF1 Notch — the Asset Uploader on the MacBook notch.
//
// Drag photos onto the notch, pick the Grand Prix and the session folder,
// "Continue in Ktulu": the photos go to Ktulu (an inbox, one day) and the Asset
// Uploader opens in the browser with everything in place. There Claude writes
// the alt texts, names and tags follow the rules, and the upload happens as
// always. The app only collects; all rules stay in Ktulu.
//
// Connect: Ktulu → Asset Uploader → Mac app → "Connect the app" hands the key
// over through the af1notch:// link. Build: mac-notch/build.sh (no Xcode).

import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

let BASE = "https://af1-ktulu.vercel.app"
let LAVA_STRONG = Color(red: 0.85, green: 0.15, blue: 0)
let MUTED = Color(red: 0.64, green: 0.65, blue: 0.67)
let SURFACE = Color(red: 0.118, green: 0.125, blue: 0.133)
let ERR = Color(red: 1, green: 0.6, blue: 0.52)

struct Race: Codable, Hashable, Identifiable {
  let round: Int; let label: String; let country: String
  let start: String?; let end: String?; let year: Int; let folderPath: String?; let sessions: [String]
  var id: Int { round }
}
struct Setup: Codable { let user: String; let races: [Race]; let sessions: [String] }

struct Photo: Identifiable, Equatable {
  let id = UUID()
  let url: URL
  let thumb: NSImage?
  static func == (a: Photo, b: Photo) -> Bool { a.id == b.id }
}

func thumbnail(_ url: URL, _ px: Int) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: px] as CFDictionary)
}

// upright, 2560 px on the long side, JPEG: the browser makes the WebP, like for every batch
func jpeg(_ url: URL) -> Data? {
  guard let cg = thumbnail(url, 2560) else { return nil }
  let out = NSMutableData()
  guard let d = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
  CGImageDestinationAddImage(d, cg, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
  return CGImageDestinationFinalize(d) ? out as Data : nil
}

@MainActor
final class Model: ObservableObject {
  @Published var token = UserDefaults.standard.string(forKey: "token") ?? ""
  @Published var setup: Setup?
  @Published var error: String?
  @Published var round: Int?
  @Published var session = ""
  @Published var photos: [Photo] = []
  @Published var expanded = false
  // hovering shows only a small note under the notch; the big panel opens with files
  @Published var peek = false
  @Published var sending: (done: Int, total: Int)?
  var onExpand: ((Bool) -> Void)?

  var race: Race? { setup?.races.first { $0.round == round } }
  var sessions: [String] {
    var s = race?.sessions ?? []
    for x in setup?.sessions ?? [] where !s.contains(where: { $0.caseInsensitiveCompare(x) == .orderedSame }) { s.append(x) }
    return s
  }

  func expand(_ on: Bool) {
    if on { peek = false }
    if expanded == on { return }
    expanded = on
    onExpand?(on)
  }
  func setPeek(_ on: Bool) {
    if peek == on { return }
    peek = on
    onExpand?(expanded)
  }

  // the peek note, clicked: pick photos in a file dialog (or connect first)
  func pickFiles() {
    if token.isEmpty || setup == nil { expand(true); return }
    let o = NSOpenPanel()
    o.allowsMultipleSelection = true
    o.canChooseDirectories = false
    o.allowedContentTypes = [.image]
    NSApp.activate(ignoringOtherApps: true)
    if o.runModal() == .OK { add(o.urls) }
  }

  func connect(_ t: String) {
    token = t.trimmingCharacters(in: .whitespacesAndNewlines)
    UserDefaults.standard.set(token, forKey: "token")
    setup = nil
    Task { await load() }
  }

  func load() async {
    guard !token.isEmpty else { return }
    do {
      let (data, res) = try await URLSession.shared.data(from: URL(string: "\(BASE)/api/notch/\(token)")!)
      guard (res as? HTTPURLResponse)?.statusCode == 200 else {
        error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Ktulu answered \((res as? HTTPURLResponse)?.statusCode ?? 0)"
        return
      }
      let s = try JSONDecoder().decode(Setup.self, from: data)
      setup = s
      error = nil
      if round == nil { round = Model.currentRace(s.races)?.round }
    } catch { self.error = "No connection to Ktulu" }
  }

  // the race weekend now (± 3 days), else the next one, else the last one
  static func currentRace(_ races: [Race]) -> Race? {
    let day = { (s: String?) -> Date? in
      guard let s else { return nil }
      let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
    let now = Date()
    if let on = races.first(where: { r in
      guard let a = day(r.start), let b = day(r.end ?? r.start) else { return false }
      return a.addingTimeInterval(-3 * 86400) <= now && now <= b.addingTimeInterval(3 * 86400)
    }) { return on }
    return races.first(where: { day($0.start).map { $0 > now } ?? false }) ?? races.last
  }

  func add(_ urls: [URL]) {
    for u in urls where (UTType(filenameExtension: u.pathExtension)?.conforms(to: .image) ?? false) && !photos.contains(where: { $0.url == u }) {
      photos.append(Photo(url: u, thumb: thumbnail(u, 120).map { NSImage(cgImage: $0, size: NSSize(width: $0.width, height: $0.height)) }))
    }
    if !photos.isEmpty { withAnimation(.spring(response: 0.36, dampingFraction: 0.86)) { expand(true) } }
  }

  private func post(_ body: [String: Any]) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: "\(BASE)/api/notch/\(token)")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    req.timeoutInterval = 60
    let (data, _) = try await URLSession.shared.data(for: req)
    let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    if let e = j["error"] as? String { throw NSError(domain: "af1", code: 1, userInfo: [NSLocalizedDescriptionKey: e]) }
    return j
  }

  // the photos to Ktulu, then the Asset Uploader opens with them
  func send() async {
    guard let r = race else { error = "Pick the Grand Prix"; return }
    error = nil
    sending = (0, photos.count)
    defer { sending = nil }
    do {
      let start = try await post(["action": "start", "round": r.round, "session": session])
      guard let inbox = start["inbox"] as? String, let open = start["open"] as? String else { throw NSError(domain: "af1", code: 2) }
      for (i, p) in photos.enumerated() {
        let file = p.url
        guard let data = await Task.detached(operation: { jpeg(file) }).value else { continue }
        let b64 = data.base64EncodedString()
        let size = 700_000
        let parts = max(1, Int(ceil(Double(b64.count) / Double(size))))
        var fileId: String?
        let chars = Array(b64.utf8)
        for n in 0..<parts {
          let slice = String(decoding: chars[(n * size)..<min(chars.count, (n + 1) * size)], as: UTF8.self)
          var body: [String: Any] = ["action": "add", "inbox": inbox, "name": file.deletingPathExtension().lastPathComponent + ".jpg", "mime": "image/jpeg", "parts": parts, "part": n, "data": slice]
          if let fileId { body["file"] = fileId }
          let j = try await post(body)
          fileId = j["file"] as? String
        }
        sending = (i + 1, photos.count)
      }
      NSWorkspace.shared.open(URL(string: BASE + open)!)
      photos.removeAll()
      expand(false)
    } catch { self.error = error.localizedDescription }
  }
}

// ---- views ---------------------------------------------------------------------
struct NotchView: View {
  @ObservedObject var m: Model
  @State private var target = false
  @State private var pending: DispatchWorkItem?
  let notch: CGSize

  var body: some View {
    ZStack(alignment: .top) {
      if m.expanded {
        Expanded(m: m)
          .frame(width: 560, height: 360)
          .background(UnevenRoundedRectangle(bottomLeadingRadius: 22, bottomTrailingRadius: 22).fill(Color.black))
          .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
      } else if m.peek {
        Button { m.pickFiles() } label: {
          HStack(spacing: 8) {
            Image(systemName: m.token.isEmpty ? "link" : "arrow.down.to.line").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            Text(m.token.isEmpty ? "Connect AF1 Notch with Ktulu" : "Drop photos · \(m.race?.label ?? "Asset Uploader")")
              .font(.system(size: 12.5, weight: .medium)).foregroundColor(.white).lineLimit(1)
          }
          .padding(.top, notch.height + 6).padding(.bottom, 9).padding(.horizontal, 16)
          .frame(minWidth: notch.width + 40)
          .background(UnevenRoundedRectangle(bottomLeadingRadius: 16, bottomTrailingRadius: 16).fill(Color.black))
        }
        .buttonStyle(.plain)
        .help("Click to choose photos, or drag them here")
        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .top)))
      } else {
        UnevenRoundedRectangle(bottomLeadingRadius: 10, bottomTrailingRadius: 10)
          .fill(Color.black)
          .frame(width: notch.width + (m.photos.isEmpty ? 0 : 56), height: notch.height)
          .overlay(alignment: .trailing) {
            if !m.photos.isEmpty {
              Text("\(m.photos.count)").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(LAVA_STRONG)).padding(.trailing, 10)
            }
          }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    // opens only after resting on the notch for a moment (passing through the menu bar does nothing);
    // dragging files onto it opens at once
    .onHover { h in
      pending?.cancel()
      let work = DispatchWorkItem {
        if h { if !m.expanded { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { m.setPeek(true) } } }
        else {
          withAnimation(.easeIn(duration: 0.18)) { m.setPeek(false) }
          if m.photos.isEmpty && m.sending == nil { withAnimation(.easeIn(duration: 0.2)) { m.expand(false) } }
        }
      }
      pending = work
      DispatchQueue.main.asyncAfter(deadline: .now() + (h ? 0.35 : 0.5), execute: work)
    }
    .onDrop(of: [.fileURL], isTargeted: Binding(get: { target }, set: { v in target = v; if v { withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) { m.expand(true) } } })) { providers in
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
        Text("Asset Uploader").font(.system(size: 12)).foregroundColor(MUTED)
        Spacer()
        Button { withAnimation { m.expand(false) } } label: { Image(systemName: "chevron.up").foregroundColor(MUTED) }.buttonStyle(.plain).help("Close")
      }
      .padding(.top, 38)

      if m.token.isEmpty || (m.setup == nil && m.error != nil) {
        Connect(m: m)
      } else if let s = m.setup {
        HStack(spacing: 10) {
          Picker("", selection: Binding(get: { m.round ?? 0 }, set: { m.round = $0 })) {
            ForEach(s.races) { r in Text(r.label).tag(r.round) }
          }.labelsHidden().frame(width: 280)
          Picker("", selection: $m.session) {
            Text("No session folder").tag("")
            ForEach(m.sessions, id: \.self) { Text($0).tag($0) }
          }.labelsHidden().frame(width: 200)
        }
        if m.photos.isEmpty {
          VStack(spacing: 8) {
            Image(systemName: "photo.on.rectangle.angled").font(.system(size: 30)).foregroundColor(MUTED)
            Text("Drop photos here").font(.system(size: 15, weight: .medium)).foregroundColor(.white)
            Text("Ktulu takes over: WebP, alt texts by Claude, names, tags, upload.").font(.system(size: 12)).foregroundColor(MUTED)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6, 5])).foregroundColor(Color.white.opacity(0.3)))
        } else {
          ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(76), spacing: 8), count: 6), spacing: 8) {
              ForEach(m.photos) { p in
                ZStack(alignment: .topTrailing) {
                  Group { if let t = p.thumb { Image(nsImage: t).resizable().aspectRatio(contentMode: .fill) } else { SURFACE } }
                    .frame(width: 76, height: 76).clipShape(RoundedRectangle(cornerRadius: 8))
                  Button { m.photos.removeAll { $0.id == p.id } } label: { Image(systemName: "xmark.circle.fill").foregroundColor(.white) }.buttonStyle(.plain).padding(3)
                }
              }
            }
          }
          HStack(spacing: 12) {
            if let e = m.error { Text(e).font(.system(size: 12)).foregroundColor(ERR).lineLimit(2) }
            Spacer()
            Button("Clear") { m.photos.removeAll() }.buttonStyle(.plain).foregroundColor(MUTED).font(.system(size: 13))
            Button { Task { await m.send() } } label: {
              Text(m.sending.map { "Sending \($0.done) of \($0.total) …" } ?? "Continue in Ktulu (\(m.photos.count))")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 7).background(Capsule().fill(LAVA_STRONG))
            }.buttonStyle(.plain).disabled(m.sending != nil || m.race == nil)
          }
        }
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .padding(.horizontal, 20).padding(.bottom, 16)
    .preferredColorScheme(.dark)
  }
}

struct Connect: View {
  @ObservedObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Connect the app with Ktulu").font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
      Text("Opens Ktulu in your browser. Click “Connect the app” there and you are done.").font(.system(size: 13)).foregroundColor(MUTED)
      if let e = m.error { Text(e).font(.system(size: 12)).foregroundColor(ERR) }
      HStack(spacing: 10) {
        Button { NSWorkspace.shared.open(URL(string: "\(BASE)/assets/notch")!) } label: {
          Text("Open Ktulu").font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            .padding(.horizontal, 14).padding(.vertical, 7).background(Capsule().fill(LAVA_STRONG))
        }.buttonStyle(.plain)
        Button("Paste a copied key") {
          if let s = NSPasteboard.general.string(forType: .string), s.count > 16 { m.connect(s) }
        }.buttonStyle(.plain).foregroundColor(MUTED).font(.system(size: 13))
      }
      Spacer()
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

  func applicationWillFinishLaunching(_ n: Notification) {
    // af1notch://connect?token=… from Ktulu's "Connect the app"
    NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:withReply:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
  }

  @objc func handleURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
    guard let s = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue, let c = URLComponents(string: s),
          let t = c.queryItems?.first(where: { $0.name == "token" })?.value else { return }
    model.connect(t)
    withAnimation { model.expand(true) }
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    // Edit menu, so ⌘V / ⌘C work in the fields
    let main = NSMenu()
    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    NSApp.mainMenu = main

    let screen = NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!
    var notch = CGSize(width: 200, height: 32)
    if let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea { notch = CGSize(width: screen.frame.width - l.width - r.width, height: screen.safeAreaInsets.top) }
    self.screen = screen
    self.notch = notch
    let start = rect(for: .collapsed)
    panel = NotchPanel(contentRect: start, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.isMovable = false
    let host = NSHostingView(rootView: NotchView(m: model, notch: notch))
    host.autoresizingMask = [.width, .height]
    panel.contentView = host
    // the window is only ever as big as what is visible: the notch, the small note, or the panel
    model.onExpand = { [weak self] on in
      guard let self else { return }
      if on { NSApp.activate(ignoringOtherApps: true); self.panel.makeKey() }
      self.layout()
    }
    panel.orderFrontRegardless()
    layout()

    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.title = "AF1"
    let menu = NSMenu()
    let open = NSMenuItem(title: "Open", action: #selector(openPanel), keyEquivalent: ""); open.target = self; menu.addItem(open)
    let conn = NSMenuItem(title: "Connect with Ktulu …", action: #selector(openConnect), keyEquivalent: ""); conn.target = self; menu.addItem(conn)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit AF1 Notch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    status.menu = menu
    Task { await model.load() }
  }

  var screen: NSScreen!
  var notch = CGSize(width: 200, height: 32)
  enum Size { case collapsed, peek, full }

  func rect(for size: Size) -> NSRect {
    let f = screen.frame
    let wh: CGSize
    switch size {
    case .collapsed: wh = CGSize(width: notch.width + (model.photos.isEmpty ? 8 : 64), height: notch.height)
    case .peek: wh = CGSize(width: max(notch.width + 60, 380), height: notch.height + 40)
    case .full: wh = CGSize(width: 580, height: 372)
    }
    return NSRect(x: f.midX - wh.width / 2, y: f.maxY - wh.height, width: wh.width, height: wh.height)
  }

  // growing happens at once; shrinking waits for the closing animation
  func layout() {
    let size: Size = model.expanded ? .full : model.peek ? .peek : .collapsed
    let target = rect(for: size)
    if target.width >= panel.frame.width { panel.setFrame(target, display: true) }
    else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) { [weak self] in
        guard let self else { return }
        let now: Size = self.model.expanded ? .full : self.model.peek ? .peek : .collapsed
        self.panel.setFrame(self.rect(for: now), display: true)
      }
    }
  }

  @objc func openPanel() { withAnimation { model.expand(true) } }
  @objc func openConnect() { NSWorkspace.shared.open(URL(string: "\(BASE)/assets/notch")!) }
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
