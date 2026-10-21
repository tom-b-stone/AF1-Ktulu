// AF1 Asset Tool — the Asset Uploader on the MacBook notch.
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
    if !photos.isEmpty { withAnimation(MOTION) { expand(true) } }
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
let ICON_W: CGFloat = 34

// frosted glass behind the window (the desktop shows through, blurred), a dark tint for contrast,
// a thin light edge and a soft drop shadow
struct VisualEffect: NSViewRepresentable {
  // SwiftUI opacity does not reach a behind-window blur, so it fades itself
  var visible = true
  func makeNSView(context: Context) -> NSVisualEffectView {
    let v = NSVisualEffectView()
    v.material = .hudWindow
    v.blendingMode = .behindWindow
    v.state = .active
    v.wantsLayer = true
    v.alphaValue = visible ? 1 : 0
    return v
  }
  func updateNSView(_ v: NSVisualEffectView, context: Context) {
    let to: CGFloat = visible ? 1 : 0
    if v.alphaValue == to { return }
    NSAnimationContext.runAnimationGroup { c in
      c.duration = visible ? 0.28 : 0.18
      c.timingFunction = CAMediaTimingFunction(name: visible ? .easeOut : .easeIn)
      v.animator().alphaValue = to
    }
  }
}
// ---- one shape that morphs: notch → note → panel ---------------------------------
// The window never changes size (no flicker). It covers the area the panel can
// grow into, and lets every click through except where the shape is.
enum Stage { case closed, note, open }
let CANVAS = CGSize(width: 640, height: 430)
let NOTE_W: CGFloat = 400
let PANEL = CGSize(width: 560, height: 360)
let MOTION = Animation.spring(response: 0.46, dampingFraction: 0.86)

// the notch's own outline: small concave "ears" at the top, rounded bottom corners
struct NotchShape: Shape {
  var ear: CGFloat
  var bottom: CGFloat
  var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(ear, bottom) }
    set { ear = newValue.first; bottom = newValue.second }
  }
  func path(in r: CGRect) -> Path {
    var p = Path()
    let w = r.width, h = r.height, e = ear, b = min(bottom, h / 2)
    p.move(to: CGPoint(x: 0, y: 0))
    p.addQuadCurve(to: CGPoint(x: e, y: e), control: CGPoint(x: e, y: 0))
    p.addLine(to: CGPoint(x: e, y: h - b))
    p.addQuadCurve(to: CGPoint(x: e + b, y: h), control: CGPoint(x: e, y: h))
    p.addLine(to: CGPoint(x: w - e - b, y: h))
    p.addQuadCurve(to: CGPoint(x: w - e, y: h - b), control: CGPoint(x: w - e, y: h))
    p.addLine(to: CGPoint(x: w - e, y: e))
    p.addQuadCurve(to: CGPoint(x: w, y: 0), control: CGPoint(x: w - e, y: 0))
    p.closeSubpath()
    return p
  }
}

struct Geometry {
  let notch: CGSize
  func ear(_ s: Stage) -> CGFloat { s == .closed ? 6 : 12 }
  func radius(_ s: Stage) -> CGFloat { s == .open ? 26 : s == .note ? 18 : 9 }
  // the shape's frame in the window (origin top left), ears included. Closed it sits exactly behind the notch.
  func rect(_ stage: Stage, photos: Bool) -> CGRect {
    let mid = CANVAS.width / 2, e = ear(stage)
    switch stage {
    case .closed:
      // the notch, extended to the left for the icon (and to the right for the photo count)
      let left = notch.width / 2 + ICON_W + e, right = notch.width / 2 + (photos ? 56 : 0) + e
      return CGRect(x: mid - left, y: 0, width: left + right, height: notch.height)
    case .note: return CGRect(x: mid - NOTE_W / 2 - e, y: 0, width: NOTE_W + 2 * e, height: notch.height + 40)
    case .open: return CGRect(x: mid - PANEL.width / 2 - e, y: 0, width: PANEL.width + 2 * e, height: PANEL.height)
    }
  }
  // what reacts to the mouse: the shape, plus the icon left of the notch (and the count right of it) when closed
  func hit(_ stage: Stage, photos: Bool) -> CGRect {
    rect(stage, photos: photos)
  }
  // where the icon sits: left of the notch, then in the note, then in the panel's header (and how big)
  func icon(_ stage: Stage, in r: CGRect) -> (CGPoint, CGFloat) {
    let e = ear(stage)
    switch stage {
    case .closed: return (CGPoint(x: e + ICON_W / 2 + 2, y: notch.height / 2), 18)
    case .note: return (CGPoint(x: e + 30, y: notch.height + 20), 24)
    case .open: return (CGPoint(x: e + 34, y: 48), 28)
    }
  }
}

struct NotchView: View {
  @ObservedObject var m: Model
  let g: Geometry
  @State private var target = false
  @State private var pending: DispatchWorkItem?

  var stage: Stage { m.expanded ? .open : m.peek ? .note : .closed }

  var body: some View {
    let r = g.rect(stage, photos: !m.photos.isEmpty)
    let (iconAt, iconSize) = g.icon(stage, in: r)
    let e = g.ear(stage)
    let shape = NotchShape(ear: e, bottom: g.radius(stage))
    ZStack(alignment: .topLeading) {
      // background: solid black like the notch when closed (it extends the notch), frosted glass when open
      ZStack {
        VisualEffect(visible: stage != .closed)
        Color.black.opacity(stage == .closed ? 1 : stage == .note ? 0.5 : 0.66)
      }
      .clipShape(shape)
      .overlay(shape.stroke(Color.white.opacity(stage == .closed ? 0 : 0.12), lineWidth: 1))
      .shadow(color: .black.opacity(stage == .closed ? 0 : 0.5), radius: 16, x: 0, y: 10)

      // the note
      Text(m.token.isEmpty ? "Connect AF1 Asset Tool with Ktulu" : "Drop photos · \(m.race?.label ?? "Asset Uploader")")
        .font(.system(size: 12.5, weight: .medium)).foregroundColor(.white).lineLimit(1)
        .frame(width: NOTE_W - 70, alignment: .leading)
        .position(x: e + 50 + (NOTE_W - 70) / 2, y: g.notch.height + 20)
        .opacity(stage == .note ? 1 : 0)
        .animation(stage == .note ? MOTION.delay(0.08) : .easeOut(duration: 0.1), value: stage)

      // the panel's content
      Expanded(m: m)
        .frame(width: PANEL.width, height: PANEL.height, alignment: .top)
        .offset(x: e)
        .opacity(stage == .open ? 1 : 0)
        .animation(stage == .open ? .easeOut(duration: 0.22).delay(0.14) : .easeOut(duration: 0.08), value: stage)
        .allowsHitTesting(stage == .open)

      // photo count while closed
      if stage == .closed && !m.photos.isEmpty {
        Text("\(m.photos.count)").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
          .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(LAVA_STRONG))
          .position(x: r.width - e - 28, y: g.notch.height / 2)
          .transition(.opacity)
      }

      // the icon: grows and moves from beside the notch into the note and the panel
      Button { if stage != .open { m.pickFiles() } } label: {
        ZStack {
          Circle().fill(LAVA_STRONG)
          Image(systemName: m.token.isEmpty ? "link" : "photo.on.rectangle.angled").font(.system(size: iconSize * 0.48, weight: .bold)).foregroundColor(.white)
        }
        .frame(width: iconSize, height: iconSize)
        .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .help("AF1 Asset Tool: drop photos here or click to choose")
      .position(iconAt)
    }
    .frame(width: r.width, height: r.height, alignment: .topLeading)
    .clipShape(Rectangle().offset(x: -60, y: -40).size(width: r.width + 120, height: r.height + 80))
    .contentShape(Rectangle())
    .onHover { h in
      pending?.cancel()
      let work = DispatchWorkItem {
        if h { if !m.expanded { withAnimation(MOTION) { m.setPeek(true) } } }
        else {
          withAnimation(MOTION) {
            m.setPeek(false)
            if m.photos.isEmpty && m.sending == nil { m.expand(false) }
          }
        }
      }
      pending = work
      DispatchQueue.main.asyncAfter(deadline: .now() + (h ? 0.3 : 0.45), execute: work)
    }
    .onDrop(of: [.fileURL], isTargeted: Binding(get: { target }, set: { v in target = v; if v { withAnimation(MOTION) { m.expand(true) } } })) { providers in
      for p in providers {
        _ = p.loadObject(ofClass: URL.self) { url, _ in if let url { DispatchQueue.main.async { m.add([url]) } } }
      }
      return true
    }
    .offset(x: r.minX, y: r.minY)
    .animation(MOTION, value: stage)
    .animation(MOTION, value: m.photos.isEmpty)
    .frame(width: CANVAS.width, height: CANVAS.height, alignment: .topLeading)
  }
}

struct Expanded: View {
  @ObservedObject var m: Model
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        Color.clear.frame(width: 26, height: 1) // the icon lands here
        Text("AF1 Asset Tool").font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
        // Ktulu's mark, as in the web app
        Text("^(;,;)^").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(Color(red: 1, green: 0.27, blue: 0.1))
          .help("Hands over to Ktulu")
        Spacer()
        Button { withAnimation(MOTION) { m.expand(false) } } label: { Image(systemName: "chevron.up").foregroundColor(MUTED) }.buttonStyle(.plain).help("Close")
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
    // one fixed window over the area the panel can grow into; it never resizes, so nothing flickers
    let f = screen.frame
    let frame = NSRect(x: f.midX - CANVAS.width / 2, y: f.maxY - CANVAS.height, width: CANVAS.width, height: CANVAS.height)
    panel = NotchPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.isMovable = false
    panel.ignoresMouseEvents = true
    let host = NSHostingView(rootView: NotchView(m: model, g: Geometry(notch: notch)))
    host.autoresizingMask = [.width, .height]
    panel.contentView = host
    model.onExpand = { [weak self] on in
      guard let self else { return }
      if on { NSApp.activate(ignoringOtherApps: true); self.panel.makeKey() }
      self.track()
    }
    panel.setFrame(frame, display: true)
    panel.orderFrontRegardless()
    // clicks pass through everywhere except the visible shape (checked 20× a second)
    let t = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.track() }
    }
    RunLoop.main.add(t, forMode: .common)

    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.title = "AF1"
    let menu = NSMenu()
    let open = NSMenuItem(title: "Open", action: #selector(openPanel), keyEquivalent: ""); open.target = self; menu.addItem(open)
    let conn = NSMenuItem(title: "Connect with Ktulu …", action: #selector(openConnect), keyEquivalent: ""); conn.target = self; menu.addItem(conn)
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit AF1 Asset Tool", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    status.menu = menu
    Task { await model.load() }
  }

  var screen: NSScreen!
  var notch = CGSize(width: 200, height: 32)

  // the shape's rect on screen, a little padded so hover feels forgiving
  func track() {
    let stage: Stage = model.expanded ? .open : model.peek ? .note : .closed
    let r = Geometry(notch: notch).hit(stage, photos: !model.photos.isEmpty)
    let top = panel.frame.maxY, left = panel.frame.minX
    let onScreen = NSRect(x: left + r.minX, y: top - r.maxY, width: r.width, height: r.height).insetBy(dx: -6, dy: -6)
    let inside = onScreen.contains(NSEvent.mouseLocation) || model.sending != nil
    if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
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
