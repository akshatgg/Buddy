// BuddyHelper: the Mac side of Buddy, started once by the Electron main
// process (src/main/helper.js). One JSON object per line on stdin and stdout:
//
//   request  {"id": 1, "cmd": "paste", "args": {...}}
//   reply    {"id": 1, "ok": true, "result": {...}}
//            {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//   event    {"event": "frontApp", "pid": 123, "bundleId": "...", "name": "..."}
//
// Commands run one at a time on a background queue; the main thread only runs
// the run loop, so NSWorkspace notifications keep arriving while a command
// waits. When stdin closes (Buddy quit) the helper exits.

import AppKit
import ApplicationServices
import ScreenCaptureKit

let ownerPid: pid_t = {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "--owner-pid"), i + 1 < args.count, let p = Int32(args[i + 1]) {
        return p
    }
    return getppid()
}()

// MARK: - output

let outLock = NSLock()

func send(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    outLock.lock()
    defer { outLock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

struct HelperError: Error {
    let code: String
    let message: String
}

// MARK: - which app is in front

let frontLock = NSLock()
var currentFront: pid_t = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0

func frontPid() -> pid_t {
    frontLock.lock()
    defer { frontLock.unlock() }
    return currentFront
}

func appInfo(_ app: NSRunningApplication) -> [String: Any] {
    ["pid": Int(app.processIdentifier), "bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? ""]
}

func noteFront(_ app: NSRunningApplication?) {
    // An app that is still launching has no process id yet (it reads -1): it is neither tracked nor reported.
    guard let app, app.processIdentifier > 0 else { return }
    frontLock.lock()
    currentFront = app.processIdentifier
    frontLock.unlock()
    // Buddy itself is never the app the user is writing in.
    if app.processIdentifier == ownerPid || app.processIdentifier == getpid() { return }
    var event = appInfo(app)
    event["event"] = "frontApp"
    send(event)
}

func waitFront(_ pid: pid_t, _ seconds: Double) -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if frontPid() == pid { return true }
        usleep(20_000)
    }
    return frontPid() == pid
}

/// Bring `pid` to the front. Returns how it got there, or nil when it could not.
func ensureFront(_ pid: pid_t) -> String? {
    if waitFront(pid, 0.25) { return "already" }
    guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
    app.activate()
    if waitFront(pid, 0.4) { return "activate" }
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXFrontmost" as CFString, kCFBooleanTrue)
    if waitFront(pid, 0.4) { return "ax" }
    return nil
}

// MARK: - permissions

func accessibilityTrusted(prompt: Bool) -> Bool {
    AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": prompt] as CFDictionary)
}

// MARK: - keyboard and clipboard

enum Key: CGKeyCode {
    case a = 0x00
    case c = 0x08
    case v = 0x09
}

func pressCommand(_ key: Key) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

typealias SavedClipboard = [[(NSPasteboard.PasteboardType, Data)]]

func saveClipboard() -> SavedClipboard {
    (NSPasteboard.general.pasteboardItems ?? []).map { item in
        item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
    }
}

func restoreClipboard(_ saved: SavedClipboard) {
    let pb = NSPasteboard.general
    pb.clearContents()
    let items: [NSPasteboardItem] = saved.map { pairs in
        let item = NSPasteboardItem()
        for (type, data) in pairs { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { pb.writeObjects(items) }
}

/// One line on stderr, which Buddy's main process passes on to its own log. It only ever holds
/// codes and numbers, never any text that came from an app.
func logLine(_ text: String) {
    FileHandle.standardError.write(Data("[buddy-helper] \(text)\n".utf8))
}

/// Is the field that has the keyboard focus in the app `pid` a password field?
///
/// This asks the app itself. The system-wide element is no use: on this Mac its focused-element
/// lookup fails every time (kAXErrorCannotComplete, -25204), which left the old guard switched off.
/// A role or a subrole of AXSecureTextField both count, whichever one an app reports.
///
/// When the focus cannot be determined (an app that does not answer Accessibility) this says so
/// on stderr and answers false, so the read goes on: most apps refuse to copy out of a password
/// field anyway, and refusing here would break Fix in every app that does not answer.
func focusedIsSecure(_ pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    // A hung app must not keep the helper waiting longer than the JavaScript side does (5 s).
    AXUIElementSetMessagingTimeout(app, 1.0)
    var focused: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(app, "AXFocusedUIElement" as CFString, &focused)
    guard status == .success, let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() else {
        logLine("could not tell which field has the focus (AX error \(status.rawValue)); going on")
        return false
    }
    let element = value as! AXUIElement
    return ["AXSubrole", "AXRole"].contains { name in
        var attribute: CFTypeRef?
        AXUIElementCopyAttributeValue(element, name as CFString, &attribute)
        return (attribute as? String) == "AXSecureTextField"
    }
}

// MARK: - commands

func pidArg(_ args: [String: Any]) throws -> pid_t {
    guard let n = args["pid"] as? Int, n > 0 else { throw HelperError(code: "bad_request", message: "pid is required") }
    return pid_t(n)
}

func needAccessibility() throws {
    if !accessibilityTrusted(prompt: false) {
        throw HelperError(code: "no_accessibility", message: "Buddy needs Accessibility permission. Open Settings (⚙︎) to allow it.")
    }
}

func captureSelection(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    guard ensureFront(pid) != nil else { throw HelperError(code: "not_frontmost", message: "Could not switch back to that app.") }
    if focusedIsSecure(pid) { throw HelperError(code: "secure_field", message: "I don't read password fields.") }

    let pb = NSPasteboard.general
    let saved = saveClipboard()
    let before = pb.changeCount
    if args["selectAll"] as? Bool == true {
        pressCommand(.a)
        usleep(80_000)
    }
    pressCommand(.c)
    var text = ""
    let end = Date().addingTimeInterval(0.3)
    while Date() < end {
        if pb.changeCount != before {
            text = pb.string(forType: .string) ?? ""
            break
        }
        usleep(15_000)
    }
    restoreClipboard(saved)
    return ["text": text]
}

func paste(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    guard let text = args["text"] as? String else { throw HelperError(code: "bad_request", message: "text is required") }
    try needAccessibility()
    guard let via = ensureFront(pid) else { throw HelperError(code: "not_frontmost", message: "Could not switch back to that app.") }
    // Buddy never types into a password field (and "Replace all" would wipe what is in it): the
    // answer goes to the clipboard instead, which is what a paste that fails does.
    if focusedIsSecure(pid) { throw HelperError(code: "secure_field", message: "I don't type into password fields.") }

    let pb = NSPasteboard.general
    let saved = saveClipboard()
    pb.clearContents()
    pb.setString(text, forType: .string)
    if args["selectAll"] as? Bool == true {
        pressCommand(.a)
        usleep(80_000)
    }
    pressCommand(.v)
    // The target app reads the clipboard after it handles ⌘V; restoring too
    // early would paste the user's old clipboard instead.
    usleep(500_000)
    restoreClipboard(saved)
    return ["via": via]
}

final class ResultBox: @unchecked Sendable {
    var value: Result<String, Error>?
}

func frontWindowId(_ pid: pid_t) -> CGWindowID? {
    // CGWindowList is ordered front to back, which SCShareableContent is not.
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return nil }
    for info in list {
        guard (info[kCGWindowOwnerPID as String] as? Int) == Int(pid),
              (info[kCGWindowLayer as String] as? Int) == 0,
              let number = info[kCGWindowNumber as String] as? Int else { continue }
        return CGWindowID(number)
    }
    return nil
}

func captureWindow(_ pid: pid_t) async throws -> String {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    let windowId = frontWindowId(pid)
    let window = content.windows.first(where: { $0.windowID == windowId })
        ?? content.windows
            .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
            .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    guard let window else { throw HelperError(code: "no_window", message: "No window to capture.") }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let scale = CGFloat(filter.pointPixelScale)
    var width = window.frame.width * scale
    var height = window.frame.height * scale
    let longEdge = max(width, height)
    if longEdge > 1568 {
        width *= 1568 / longEdge
        height *= 1568 / longEdge
    }
    let config = SCStreamConfiguration()
    config.width = Int(width)
    config.height = Int(height)
    config.showsCursor = false

    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    guard let jpeg = NSBitmapImageRep(cgImage: image)
            .representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
        throw HelperError(code: "capture_failed", message: "Could not encode the screenshot.")
    }
    return jpeg.base64EncodedString()
}

func screenshot(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    if !CGPreflightScreenCaptureAccess() {
        throw HelperError(code: "no_screen_recording", message: "Buddy needs Screen Recording permission for Check screen. Open Settings (⚙︎) to allow it.")
    }
    let box = ResultBox()
    let done = DispatchSemaphore(value: 0)
    Task {
        do { box.value = .success(try await captureWindow(pid)) } catch { box.value = .failure(error) }
        done.signal()
    }
    done.wait()
    switch box.value {
    case .success(let image): return ["image": image]
    case .failure(let error as HelperError): throw error
    case .failure(let error): throw HelperError(code: "capture_failed", message: error.localizedDescription)
    case nil: throw HelperError(code: "capture_failed", message: "No screenshot.")
    }
}

func handle(_ msg: [String: Any]) {
    let id = msg["id"] ?? NSNull()
    let args = msg["args"] as? [String: Any] ?? [:]
    do {
        let result: [String: Any]
        switch msg["cmd"] as? String ?? "" {
        case "ping":
            result = ["pong": true]
        case "frontmost":
            let app = NSWorkspace.shared.frontmostApplication
            result = app.map(appInfo) ?? [:]
        case "permissions":
            result = ["accessibility": accessibilityTrusted(prompt: false),
                      "screenRecording": CGPreflightScreenCaptureAccess()]
        case "requestAccessibility":
            result = ["granted": accessibilityTrusted(prompt: true)]
        case "requestScreenRecording":
            result = ["granted": CGRequestScreenCaptureAccess()]
        case "captureSelection":
            result = try captureSelection(args)
        case "paste":
            result = try paste(args)
        case "screenshot":
            result = try screenshot(args)
        default:
            throw HelperError(code: "bad_request", message: "unknown command")
        }
        send(["id": id, "ok": true, "result": result])
    } catch let error as HelperError {
        send(["id": id, "ok": false, "error": ["code": error.code, "message": error.message]])
    } catch {
        send(["id": id, "ok": false, "error": ["code": "failed", "message": error.localizedDescription]])
    }
}

// MARK: - start

let work = DispatchQueue(label: "buddy.helper.work")

NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { note in
    noteFront(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
}
noteFront(NSWorkspace.shared.frontmostApplication)

Thread {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
        work.async { handle(msg) }
    }
    exit(0)
}.start()

RunLoop.main.run()
