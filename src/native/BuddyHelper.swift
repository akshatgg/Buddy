// BuddyHelper: the Mac side of Buddy, started once by the Electron main
// process (src/main/helper.js). One JSON object per line on stdin and stdout:
//
//   request  {"id": 1, "cmd": "paste", "args": {...}}
//   reply    {"id": 1, "ok": true, "result": {...}}
//            {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//   event    {"event": "frontApp", "pid": 123, "bundleId": "...", "name": "..."}
//            {"event": "keys", "kind": "flags", "keyCode": 61, "flags": 524608, "t": 81234567}   (while watchKeys is on)
//            {"event": "keys", "kind": "other"}
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
    case d = 0x02
    case v = 0x09
    case z = 0x06
    case returnKey = 0x24
    case rightArrow = 0x7C // 124
}

/// `key` with the modifier keys `flags` held, into the app in front.
func pressKeys(_ key: Key, _ flags: CGEventFlags) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: false)
    down?.flags = flags
    up?.flags = flags
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func pressCommand(_ key: Key) {
    pressKeys(key, .maskCommand)
}

/// A key on its own, with no modifiers, sent straight to the app `pid`.
func pressKey(_ key: Key, toPid pid: pid_t) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: key.rawValue, keyDown: false)
    down?.flags = []
    up?.flags = []
    down?.postToPid(pid)
    up?.postToPid(pid)
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

// Clipboard-history apps skip a clipboard that carries this type (see nspasteboard.org): it says the
// contents are only there for a moment.
let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

/// Buddy's own temporary write: the text that is about to be pasted, marked as transient.
func writeTemporary(_ text: String, to pb: NSPasteboard) {
    pb.declareTypes([.string, transientType], owner: nil)
    pb.setString(text, forType: .string)
    pb.setData(Data(), forType: transientType)
}

/// One line on stderr, which Buddy's main process passes on to its own log. It holds codes, numbers
/// and the system's own error descriptions, never any text that came from an app or from the person.
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
    // Kept next to the read it guards, although the process-wide timeout set at startup covers it too.
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

/// True only when the focused element is surely not a place to type: a web page, a mail being read, plain text or a
/// link that was clicked or selected. Then a paste would do nothing, and Buddy would say "Done!" for nothing: the text
/// goes to the clipboard instead (src/main/actions.js). Anything Buddy cannot tell about counts as a place to type, as
/// before, so that a paste is never refused by mistake.
func focusedIsReadOnly(_ pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1.0)
    var focused: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(app, "AXFocusedUIElement" as CFString, &focused)
    guard status == .success, let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() else { return false }
    let element = value as! AXUIElement
    var role: CFTypeRef?
    AXUIElementCopyAttributeValue(element, "AXRole" as CFString, &role)
    guard let name = role as? String, ["AXWebArea", "AXStaticText", "AXLink", "AXHeading", "AXImage"].contains(name) else { return false }
    // Inside something editable after all (a box in a web page), or its text can be set: a place to type.
    var ancestor: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, "AXEditableAncestor" as CFString, &ancestor) == .success, ancestor != nil { return false }
    var settable: DarwinBoolean = false
    if AXUIElementIsAttributeSettable(element, "AXValue" as CFString, &settable) == .success, settable.boolValue { return false }
    return true
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
    // The count comes first, before anything is saved or copied: if it has moved by the end, something put
    // new contents on the clipboard (the copy, or anyone else).
    let before = pb.changeCount
    let saved = saveClipboard()
    let selectAll = args["selectAll"] as? Bool == true
    if selectAll {
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
    // "Use the whole box" left everything selected in the person's app. Collapse the selection, so that the
    // first key they type does not replace their whole draft. Replace selects everything again before it pastes.
    if selectAll { pressKey(.rightArrow, toPid: pid) }
    // Put the person's clipboard back only if it changed. A copy that copied nothing leaves it as it was, and
    // writing it again would add an entry to clipboard-history apps, read every type it holds into memory, and
    // could defeat a password manager that clears the clipboard only while it is unchanged.
    if pb.changeCount != before { restoreClipboard(saved) }
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
    if focusedIsReadOnly(pid) { throw HelperError(code: "not_editable", message: "Click in the box where it should go, then try again.") }

    let pb = NSPasteboard.general
    let saved = saveClipboard()
    writeTemporary(text, to: pb)
    if args["selectAll"] as? Bool == true {
        pressCommand(.a)
        usleep(80_000)
    }
    pressCommand(.v)
    // The target app reads the clipboard after it handles ⌘V; restoring too
    // early would paste the user's old clipboard instead.
    usleep(500_000)
    // Always put it back: Buddy's own write above changed the clipboard (writeTemporary always bumps the
    // change count), so a check for a changed count would always say yes.
    restoreClipboard(saved)
    return ["via": via]
}

// The keys `press` may send and the modifiers it may hold, by the names Buddy uses (src/main/send-keys.js): ↩ sends,
// ⌘Z undoes, and ⌘⇧D sends in Mail. Nothing else, so that Buddy can never be made to press just any key.
let pressableKeys: [String: Key] = ["return": .returnKey, "z": .z, "d": .d]
let modifierFlags: [String: CGEventFlags] = ["cmd": .maskCommand, "ctrl": .maskControl, "shift": .maskShift, "alt": .maskAlternate]

func modifiersArg(_ args: [String: Any]) throws -> CGEventFlags {
    let given = args["modifiers"] ?? NSNull()
    if given is NSNull { return [] }
    guard let names = given as? [String] else {
        throw HelperError(code: "bad_request", message: "modifiers must be a list")
    }
    var flags: CGEventFlags = []
    for name in names {
        guard let flag = modifierFlags[name] else {
            throw HelperError(code: "bad_request", message: "modifiers must be cmd, ctrl, shift or alt")
        }
        flags.insert(flag)
    }
    return flags
}

/// One key with its modifiers, like ⌘↩ (Send) or ⌘Z (Undo), into the app `pid`, brought to the front first. It is
/// refused wherever Paste is: Buddy never types into a password field.
func press(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    guard let name = args["key"] as? String, let key = pressableKeys[name] else {
        throw HelperError(code: "bad_request", message: "key must be return, z or d")
    }
    let flags = try modifiersArg(args)
    try needAccessibility()
    guard let via = ensureFront(pid) else { throw HelperError(code: "not_frontmost", message: "Could not switch back to that app.") }
    if focusedIsSecure(pid) { throw HelperError(code: "secure_field", message: "I don't type into password fields.") }
    pressKeys(key, flags)
    return ["via": via]
}

/// The title of the app's front window, which in a browser names the site that is open (src/main/send-keys.js tells
/// Gmail from WhatsApp by it). "" when it has none or it cannot be read, as without Accessibility: never an error.
/// The title is passed on, never logged.
func windowTitle(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    guard accessibilityTrusted(prompt: false) else { return ["title": ""] }
    let app = AXUIElementCreateApplication(pid)
    for attribute in ["AXFocusedWindow", "AXMainWindow"] {
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, attribute as CFString, &window) == .success,
              let value = window, CFGetTypeID(value) == AXUIElementGetTypeID() else { continue }
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(value as! AXUIElement, kAXTitleAttribute as CFString, &title)
        if let text = title as? String, !text.isEmpty { return ["title": text] }
    }
    return ["title": ""]
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
    case .failure(let error):
        // macOS's own wording is for the log; the person gets plain words.
        logLine("the screenshot failed: \(error.localizedDescription)")
        throw HelperError(code: "capture_failed", message: "Could not take the screenshot. Try again.")
    case nil: throw HelperError(code: "capture_failed", message: "No screenshot.")
    }
}

// MARK: - the keys of a single-key shortcut

// While Buddy's shortcut is a modifier key tapped on its own (or Settings is recording one), a listen-only event tap
// reports each change of the modifier keys: which key, and all the flags, whose low bits say which side is down, with
// the time in milliseconds since the Mac started. A key, a media key (volume, brightness, play), a scroll or a click is
// reported, as "other", while a modifier flag is on (macOS also puts the fn flag on the arrow and function keys, so
// those count too): it spoils a tap, and which key it was is none of Buddy's business. The tap lives on the main run
// loop, and is looked at every 5 seconds (checkKeyTap).

var keyTap: CFMachPort?
var keyTapSource: CFRunLoopSource?
var keyTapTimer: Timer?
var keyTapTrusted = true // Accessibility was allowed when the tap was last checked
let heldModifiers: UInt64 = CGEventFlags.maskCommand.rawValue | CGEventFlags.maskShift.rawValue
    | CGEventFlags.maskControl.rawValue | CGEventFlags.maskAlternate.rawValue | CGEventFlags.maskSecondaryFn.rawValue

func onKeyEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // macOS switches a tap off when it is slow, or while a password field takes the keys; it is switched back on.
        if let tap = keyTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        send(["event": "keys", "kind": "flags",
              "keyCode": Int(event.getIntegerValueField(.keyboardEventKeycode)),
              "flags": Int(event.flags.rawValue),
              "t": Int(ProcessInfo.processInfo.systemUptime * 1000)])
    default:
        // A scroll that goes on by itself after the fingers have left the trackpad is not the person doing anything.
        if type == .scrollWheel && event.getIntegerValueField(.scrollWheelEventMomentumPhase) != 0 { break }
        // Of the system-defined events only the media keys count (subtype 8): fn and 🌐 may bring others of their own,
        // and those must not spoil a tap of fn.
        if type.rawValue == 14 && NSEvent(cgEvent: event)?.subtype.rawValue != 8 { break }
        if event.flags.rawValue & heldModifiers != 0 { send(["event": "keys", "kind": "other"]) }
    }
    return Unmanaged.passUnretained(event)
}

/// Every 5 seconds while the tap is on. macOS can switch a tap off; and a tap made before Accessibility was taken away
/// may hear no keys once it is given back, so then the tap is made again.
func checkKeyTap() {
    guard let tap = keyTap else { return }
    guard accessibilityTrusted(prompt: false) else {
        keyTapTrusted = false
        return
    }
    if !keyTapTrusted {
        keyTapTrusted = true
        try? setKeyTap(false)
        do {
            try setKeyTap(true)
        } catch {
            // No tap any more: the key watch is told, and asks again until one can be made.
            send(["event": "keys", "kind": "lost"])
        }
        return
    }
    if !CGEvent.tapIsEnabled(tap: tap) { CGEvent.tapEnable(tap: tap, enable: true) }
}

/// Start or stop reporting the keys. Runs on the main thread, where the tap lives.
func setKeyTap(_ on: Bool) throws {
    if !on {
        keyTapTimer?.invalidate()
        keyTapTimer = nil
        guard let tap = keyTap else { return }
        CGEvent.tapEnable(tap: tap, enable: false)
        if let source = keyTapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        CFMachPortInvalidate(tap)
        keyTap = nil
        keyTapSource = nil
        return
    }
    if keyTap != nil { return }
    let noAccess = HelperError(code: "no_accessibility", message: "Buddy needs Accessibility permission to hear a single key.")
    // Without Accessibility the tap would hear no keys (and macOS could ask for Input Monitoring instead).
    guard accessibilityTrusted(prompt: false) else { throw noAccess }
    // Volume, brightness and play are not key presses to macOS but system-defined events (type 14), and a scroll is not
    // a click: held with a modifier (⌥ and volume, fn and F12, ⌃ and scroll) each still spoils a tap.
    var types: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]
    if let systemDefined = CGEventType(rawValue: 14) { types.append(systemDefined) } // media keys: volume, brightness, play
    let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                      eventsOfInterest: mask, callback: onKeyEvent, userInfo: nil) else { throw noAccess }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    keyTap = tap
    keyTapSource = source
    keyTapTrusted = true
    let timer = Timer(timeInterval: 5, repeats: true) { _ in checkKeyTap() }
    RunLoop.main.add(timer, forMode: .common)
    keyTapTimer = timer
}

func watchKeys(_ args: [String: Any]) throws -> [String: Any] {
    let on = args["on"] as? Bool ?? false
    var failure: Error?
    DispatchQueue.main.sync {
        do { try setKeyTap(on) } catch { failure = error }
    }
    if let failure { throw failure }
    return ["watching": on]
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
        case "press":
            result = try press(args)
        case "windowTitle":
            result = try windowTitle(args)
        case "screenshot":
            result = try screenshot(args)
        case "watchKeys":
            result = try watchKeys(args)
        default:
            throw HelperError(code: "bad_request", message: "unknown command")
        }
        send(["id": id, "ok": true, "result": result])
    } catch let error as HelperError {
        send(["id": id, "ok": false, "error": ["code": error.code, "message": error.message]])
    } catch {
        // macOS's own wording is for the log; the person gets plain words.
        logLine("\(msg["cmd"] as? String ?? "a command") failed: \(error.localizedDescription)")
        send(["id": id, "ok": false, "error": ["code": "failed", "message": "Something went wrong. Try again."]])
    }
}

// MARK: - start

// One setting for the whole process: no Accessibility call, on any element, waits more than a second for an app
// that does not answer. A timeout set on one element reaches only that element, not the ones read from it
// (the focused field's role, say) or a new element for the same app (ensureFront's).
AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.0)

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
