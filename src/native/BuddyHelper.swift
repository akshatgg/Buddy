// BuddyHelper: the Mac side of Buddy, started once by the Electron main
// process (src/main/helper.js). One JSON object per line on stdin and stdout:
//
//   request  {"id": 1, "cmd": "paste", "args": {...}}
//   reply    {"id": 1, "ok": true, "result": {...}}
//            {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//   event    {"event": "frontApp", "pid": 123, "bundleId": "...", "name": "..."}
//            {"event": "keys", "kind": "flags", "keyCode": 61, "flags": 524608, "t": 81234567}   (while watchKeys is on)
//            {"event": "keys", "kind": "other"}
//            {"event": "tag", "pid": 123}   (while watchTyping is on: "@buddy …" was typed there, then a pause)
//            {"event": "esc"} / {"event": "took_over"}   (while watchStop is on: a real Esc, or a real key or click)
//
// Commands run one at a time on a background queue; the main thread only runs
// the run loop, so NSWorkspace notifications keep arriving while a command
// waits. When stdin closes (Buddy quit) the helper exits.

import AppKit
import ApplicationServices
import Carbon // the keyboard layouts (Text Input Sources) and UCKeyTranslate
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
    // Another app in front: what was typed before belongs to a different place (Buddy where you type).
    DispatchQueue.main.async { resetTyping() }
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

/// The keys the helper presses, by their place on an American keyboard. A letter's key is looked up in the person's
/// own keyboard layout before it is pressed (keyCode below): these places are only what is used when that fails.
enum Key: CGKeyCode {
    case a = 0x00
    case c = 0x08
    case d = 0x02
    case f = 0x03
    case v = 0x09
    case z = 0x06
    case returnKey = 0x24
    case rightArrow = 0x7C // 124
    case upArrow = 0x7E // 126

    /// The letter the key types; nil for ↩ and →, which are in the same place on every keyboard.
    var letter: String? {
        switch self {
        case .a: return "a"
        case .c: return "c"
        case .d: return "d"
        case .f: return "f"
        case .v: return "v"
        case .z: return "z"
        case .returnKey, .rightArrow, .upArrow: return nil
        }
    }
}

/// The key that types `letter` in the keyboard layout `source`, or nil when none does. With `command` it is the key
/// that types it while ⌘ is held, which is what a shortcut uses ("Dvorak – QWERTY ⌘" turns into QWERTY then).
func keyCode(typing letter: String, in source: TISInputSource, command: Bool) -> CGKeyCode? {
    guard let property = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
    let data = Unmanaged<CFData>.fromOpaque(property).takeUnretainedValue() as Data
    let modifiers = command ? UInt32(cmdKey >> 8) & 0xFF : 0
    let keyboard = UInt32(LMGetKbdType())
    return data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> CGKeyCode? in
        guard let layout = bytes.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return nil }
        for code in 0..<128 {
            var deadKeys: UInt32 = 0
            var chars = [UniChar](repeating: 0, count: 4)
            var length = 0
            let status = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), modifiers, keyboard,
                                        OptionBits(kUCKeyTranslateNoDeadKeysMask), &deadKeys, chars.count, &length, &chars)
            if status == noErr, length > 0, String(utf16CodeUnits: chars, count: length).lowercased() == letter {
                return CGKeyCode(code)
            }
        }
        return nil
    }
}

/// The key code to press for `key` with `flags` held. Key codes are places on the keyboard, not letters: where an
/// American keyboard has Z a French one has W, so ⌘Z sent by the American code would close the person's window
/// there, and ⌘A would be ⌘Q. So a letter is looked up in the keyboard layout in use, then in the one macOS uses for
/// shortcuts while a layout without Latin letters is in use (Russian, say), and only then taken from the list above.
func keyCode(_ key: Key, _ flags: CGEventFlags) -> CGKeyCode {
    guard let letter = key.letter else { return key.rawValue }
    let lookUp = { () -> CGKeyCode? in
        let layouts: [() -> Unmanaged<TISInputSource>?] = [
            TISCopyCurrentKeyboardLayoutInputSource, TISCopyCurrentASCIICapableKeyboardLayoutInputSource,
        ]
        for copy in layouts {
            guard let source = copy()?.takeRetainedValue() else { continue }
            if let code = keyCode(typing: letter, in: source, command: flags.contains(.maskCommand)) { return code }
        }
        return nil
    }
    // The keyboard layouts are asked on the main thread, as macOS wants: it only runs the run loop, while the commands
    // run on `work`.
    let found = Thread.isMainThread ? lookUp() : DispatchQueue.main.sync(execute: lookUp)
    return found ?? key.rawValue
}

/// `key` with the modifier keys `flags` held, into the app in front.
func pressKeys(_ key: Key, _ flags: CGEventFlags) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let code = keyCode(key, flags)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
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
    let code = keyCode(key, [])
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
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
    // "paragraph": from the cursor back to the start of its paragraph (⌥⇧↑), for Buddy where you type. That
    // selection is left in place, so that the paste which follows replaces just it.
    let paragraph = args["select"] as? String == "paragraph"
    if selectAll {
        pressCommand(.a)
        usleep(80_000)
    } else if paragraph {
        pressKeys(.upArrow, [.maskAlternate, .maskShift])
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

    pasteHere(text, selectAll: args["selectAll"] as? Bool == true)
    return ["via": via]
}

/// Puts `text` into the focused box of the app in front through the clipboard (⌘V, after ⌘A with `selectAll`), and
/// then gives the person their own clipboard back. Nothing in it can fail, so the clipboard is always put back.
func pasteHere(_ text: String, selectAll: Bool) {
    let pb = NSPasteboard.general
    let saved = saveClipboard()
    writeTemporary(text, to: pb)
    if selectAll {
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
}

// The keys `press` may send and the modifiers it may hold, by the names Buddy uses (src/main/send-keys.js): ↩ sends,
// ⌘Z undoes, and ⌘⇧D sends in Mail. Nothing else, so that Buddy can never be made to press just any key.
// "right" collapses a selection Buddy made and then let go of (Buddy where you type, src/main/tag.js).
let pressableKeys: [String: Key] = ["return": .returnKey, "z": .z, "d": .d, "right": .rightArrow]
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
        throw HelperError(code: "bad_request", message: "key must be return, z, d or right")
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

/// The screens that have a notch (macOS 12 and later), for Buddy to live in (src/main/home.js). Each entry is the
/// screen's frame and its notch, in Electron's points: the origin at the primary screen's top-left, y down. The notch
/// spans from the end of the area left of the camera to the start of the area right of it, as tall as the top safe
/// area inset. An empty list on a Mac without one. Screens are asked on the main thread, as AppKit wants.
func notchInfo() -> [String: Any] {
    let lookUp = { () -> [[String: Any]] in
        var notches: [[String: Any]] = []
        guard #available(macOS 12.0, *), let primary = NSScreen.screens.first else { return notches }
        let top = primary.frame.maxY
        for screen in NSScreen.screens where screen.safeAreaInsets.top > 0 {
            let frame = screen.frame
            // Whole points that cover the notch (its edges can fall on a half point), as a window's bounds must be.
            let left = floor(screen.auxiliaryTopLeftArea?.maxX ?? frame.minX)
            let right = ceil(screen.auxiliaryTopRightArea?.minX ?? frame.maxX)
            let y = top - frame.maxY
            notches.append([
                "screen": ["x": frame.minX, "y": y, "width": frame.width, "height": frame.height],
                "notch": ["x": left, "y": y, "width": right - left, "height": ceil(screen.safeAreaInsets.top)],
            ])
        }
        return notches
    }
    let notches = Thread.isMainThread ? lookUp() : DispatchQueue.main.sync(execute: lookUp)
    return ["notches": notches]
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

// MARK: Buddy where you type

// The person ends what they wrote with "@buddy" (or their buddy's name) and what to do, and pauses: Buddy is told
// which app, and reads the paragraph from there itself (src/main/tag.js). For that this watches the keys typed, into a
// short rolling buffer that lives only here, in memory: it is never sent, saved or logged. Only "a tag was typed in
// this app" leaves the helper. The buffer is emptied whenever the place being typed in may have changed.

var typingTap: CFMachPort?
var typingTapSource: CFRunLoopSource?
var typingNames: [String] = []
var typingBuffer = ""
var typingTimer: Timer?
let typingBufferMax = 120
let typingPause: TimeInterval = 1.2
// Keys that move the cursor or end what is being typed: ↩, ⌅, ⎋, ⇥, the arrows, Home, End, Page Up and Page Down.
let typingResetKeys: Set<Int64> = [36, 76, 53, 48, 123, 124, 125, 126, 115, 119, 116, 121]

/// Whether `text` holds a tag: "@" and one of the names, not inside a word or an email address.
func hasTag(_ text: String) -> Bool {
    guard !typingNames.isEmpty else { return false }
    let names = typingNames.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
    guard let pattern = try? NSRegularExpression(pattern: "(^|[^\\p{L}\\p{N}_@])@(\(names))(?![\\p{L}\\p{N}_])", options: [.caseInsensitive]) else { return false }
    return pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
}

func resetTyping() {
    typingBuffer = ""
    typingTimer?.invalidate()
    typingTimer = nil
}

/// The person paused after a tag: say so, for the app in front, unless it is a password field (or Buddy itself).
func typingPaused() {
    typingTimer = nil
    guard hasTag(typingBuffer) else { return }
    typingBuffer = ""
    let pid = frontPid()
    if pid <= 0 || pid == ownerPid || pid == getpid() || focusedIsSecure(pid) { return }
    send(["event": "tag", "pid": Int(pid)])
}

func onTypingEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap = typingTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .keyDown:
        // Keys Buddy itself sends (⌘C, ⌘V, ⌥⇧↑) are not the person typing.
        if event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid()) { break }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let held = event.flags.intersection([.maskCommand, .maskControl])
        if typingResetKeys.contains(code) || !held.isEmpty {
            resetTyping()
            break
        }
        if code == 51 { // ⌫
            if !typingBuffer.isEmpty { typingBuffer.removeLast() }
        } else if let chars = NSEvent(cgEvent: event)?.characters {
            typingBuffer += chars.filter { !$0.isNewline && $0.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) } }
            if typingBuffer.count > typingBufferMax { typingBuffer = String(typingBuffer.suffix(typingBufferMax)) }
        }
        typingTimer?.invalidate()
        typingTimer = nil
        if hasTag(typingBuffer) {
            let timer = Timer(timeInterval: typingPause, repeats: false) { _ in typingPaused() }
            RunLoop.main.add(timer, forMode: .common)
            typingTimer = timer
        }
    default:
        resetTyping() // a click: the cursor may be somewhere else now
    }
    return Unmanaged.passUnretained(event)
}

/// Start or stop watching for the tag. Runs on the main thread, where the tap lives.
func setTypingTap(_ on: Bool) throws {
    resetTyping()
    if !on {
        guard let tap = typingTap else { return }
        CGEvent.tapEnable(tap: tap, enable: false)
        if let source = typingTapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        CFMachPortInvalidate(tap)
        typingTap = nil
        typingTapSource = nil
        return
    }
    if typingTap != nil { return }
    let noAccess = HelperError(code: "no_accessibility", message: "Buddy needs Accessibility permission to fix where you type.")
    guard accessibilityTrusted(prompt: false) else { throw noAccess }
    let types: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                      eventsOfInterest: mask, callback: onTypingEvent, userInfo: nil) else { throw noAccess }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    typingTap = tap
    typingTapSource = source
}

/// watchTyping { on, names }: watch for "@" and one of `names` (lower-case words) typed anywhere.
func watchTyping(_ args: [String: Any]) throws -> [String: Any] {
    let on = args["on"] as? Bool ?? false
    let names = (args["names"] as? [String] ?? []).map { $0.lowercased() }
    let wordPattern = try NSRegularExpression(pattern: "^[\\p{L}\\p{N}_]{2,24}$")
    let good = names.filter { wordPattern.firstMatch(in: $0, range: NSRange($0.startIndex..., in: $0)) != nil }
    if on && (good.isEmpty || good.count != names.count || names.count > 4) {
        throw HelperError(code: "bad_request", message: "names must be 1 to 4 words")
    }
    var failure: Error?
    DispatchQueue.main.sync {
        typingNames = good
        do { try setTypingTap(on) } catch { failure = error }
    }
    if let failure { throw failure }
    return ["watching": on]
}

// MARK: - WhatsApp for Mac

// Buddy messages someone on WhatsApp for Mac, only after the person pressed Send on the card that shows the chat and
// the message. WhatsApp is driven by its controls' fixed ids, found on WhatsApp 26.41 (see the hey-buddy spec). Names
// and messages are passed on, never logged.

let whatsAppId = "net.whatsapp.WhatsApp"
let waSearchBoxId = "TokenizedSearchBar_TextView"
// What the search shows, in its own list (not the chat list): a chat (a button), and a contact with no chat yet (a
// text). Its other rows (messages found in a chat, media) and its headings are left alone.
let waChatResultId = "ChatListSearchView_ChatResult"
let waContactResultId = "ChatListSearchView_ContactResult"
let waHeaderId = "NavigationBar_HeaderViewButton"
let waClearButtonId = "TokenizedSearchBar_DeleteButton"
let waComposerId = "ChatBar_ComposerTextView"
// The invisible marks WhatsApp puts around names: left-to-right, right-to-left, and the embeddings and overrides, and the isolates.
let directionMarks = CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}")

let whatsAppNotReady = HelperError(code: "whatsapp_not_ready", message: "WhatsApp didn't open. Open it once, then try again.")
let waChatNotFound = HelperError(code: "chat_not_found", message: "I couldn't find that chat in WhatsApp.")
let waWrongChat = HelperError(code: "wrong_chat", message: "That opened the wrong chat, so I didn't send it.")
let waNotPutIn = HelperError(code: "not_put_in", message: "WhatsApp didn't put the message in, so I didn't send it.")

func axAttr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success ? value : nil
}

/// An attribute that is itself an element (a window, the menu bar, the focused field); nil when it is missing or is
/// something else, so that a missing element is never a crash.
func axElement(_ e: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = axAttr(e, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func axKids(_ e: AXUIElement) -> [AXUIElement] { (axAttr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func axString(_ e: AXUIElement, _ name: String) -> String { (axAttr(e, name) as? String) ?? "" }
func axId(_ e: AXUIElement) -> String { axString(e, "AXIdentifier") }

/// The first element under `root` (depth first, at most 30 deep) that passes `test`.
func axFind(_ root: AXUIElement, depth: Int = 0, _ test: (AXUIElement) -> Bool) -> AXUIElement? {
    if test(root) { return root }
    if depth > 30 { return nil }
    for kid in axKids(root) {
        if let found = axFind(kid, depth: depth + 1, test) { return found }
    }
    return nil
}

/// The id of the element that has the keyboard focus in the app `ax`, "" when there is none.
func axFocusedId(_ ax: AXUIElement) -> String {
    axElement(ax, "AXFocusedUIElement").map(axId) ?? ""
}

/// Gives `element` the keyboard focus, and says whether, within a second, the focus is on the element with the id
/// `id` in the app `pid` and that app is in front: keys pressed now go there and nowhere else.
func focusOn(_ element: AXUIElement, id: String, pid: pid_t, in ax: AXUIElement) -> Bool {
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    let end = Date().addingTimeInterval(1)
    repeat {
        usleep(100_000)
        if frontPid() == pid && axFocusedId(ax) == id { return true }
    } while Date() < end
    return false
}

/// `text` without the invisible direction marks.
func withoutMarks(_ text: String) -> String {
    text.unicodeScalars.filter { !directionMarks.contains($0) }.map(String.init).joined()
}

/// A chat's name from its row or header description: "‎Nisha, ‎1 unread message" is "Nisha".
func chatName(_ description: String) -> String {
    let clean = withoutMarks(description)
    return (clean.components(separatedBy: ", ").first ?? clean).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// A row of WhatsApp's search results that Buddy may open: a chat, or a contact with no chat yet.
enum WaResult { case chat, contact }

/// Which kind of result a row is, by its id. Messages found in a chat, media and the headings are none (nil): a
/// message found in Nisha's chat is not a chat called Nisha.
func waResultKind(_ id: String) -> WaResult? {
    switch id {
    case waChatResultId: return .chat
    case waContactResultId: return .contact
    default: return nil
    }
}

/// The results in the order Buddy uses them: the chats, then the contacts, each in WhatsApp's order. A row with no
/// name is left out.
func chatsThenContacts<Row>(_ rows: [(kind: WaResult, name: String, row: Row)]) -> [(name: String, row: Row)] {
    let named = rows.filter { !$0.name.isEmpty }
    return (named.filter { $0.kind == .chat } + named.filter { $0.kind == .contact }).map { (name: $0.name, row: $0.row) }
}

/// What a box holds, as it is compared with what was pasted in: no marks, single spaces.
func boxText(_ value: String) -> String { singleSpaced(withoutMarks(value)) }

/// A name as it is compared: no marks, no case, no accents, single spaces (shared/message-pick.js plain()).
func plainName(_ name: String) -> String {
    chatName(name).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

/// Text as it is compared with what the message box holds: every run of spaces and line breaks one space, none at
/// the ends. Case and everything else must match.
func singleSpaced(_ text: String) -> String {
    text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

/// WhatsApp's window, the front one.
func whatsAppWindow(_ ax: AXUIElement) -> AXUIElement? {
    (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first
}

/// WhatsApp running, in front, with its main window open (it is started, or its window opened, when it is not):
/// its process id and app element.
func whatsAppReady() throws -> (pid_t, AXUIElement) {
    try needAccessibility()
    // Within the 15 and 20 seconds Buddy waits for waFind and waSend (src/main/helper.js), with time left for the rest.
    let end = Date().addingTimeInterval(8)
    let running = { NSRunningApplication.runningApplications(withBundleIdentifier: whatsAppId).first(where: { $0.processIdentifier > 0 }) }
    var app = running()
    if app == nil {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: whatsAppId) else {
            throw HelperError(code: "no_whatsapp", message: "Install WhatsApp for Mac and I can message from here.")
        }
        let done = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, _ in done.signal() }
        _ = done.wait(timeout: .now() + 5)
        app = running()
        while app == nil && Date() < end {
            usleep(250_000)
            app = running()
        }
    }
    guard let pid = app?.processIdentifier else { throw whatsAppNotReady }
    let ax = AXUIElementCreateApplication(pid)
    _ = ensureFront(pid)
    var reopened = false
    while true {
        if let window = whatsAppWindow(ax), axFind(window, { axId($0) == waSearchBoxId }) != nil {
            // Keys go to the app in front: nothing is typed unless that is WhatsApp.
            guard ensureFront(pid) != nil else { throw whatsAppNotReady }
            return (pid, ax)
        }
        // Its window was closed: WhatsApp → "‎Open main window" (the title starts with an invisible mark).
        if !reopened, whatsAppWindow(ax) == nil, let bar = axElement(ax, kAXMenuBarAttribute),
           let item = axFind(bar, { axString($0, kAXTitleAttribute).contains("Open main window") }) {
            reopened = true
            AXUIElementPerformAction(item, kAXPressAction as CFString)
        }
        if Date() >= end { throw whatsAppNotReady }
        usleep(250_000)
    }
}

/// Presses File → Search in WhatsApp's menu bar, which puts the keyboard focus in the search box. (Setting the focus
/// on the box itself is answered "done" but leaves it where it was, in WhatsApp 26.41.) The titles start with an
/// invisible mark. False when there is no such item, or it did not take the press.
func pressSearchMenu(_ ax: AXUIElement) -> Bool {
    let title = { (e: AXUIElement) in withoutMarks(axString(e, kAXTitleAttribute)).trimmingCharacters(in: .whitespaces) }
    guard let bar = axElement(ax, kAXMenuBarAttribute),
          let file = axKids(bar).first(where: { title($0) == "File" }),
          let item = axFind(file, { axString($0, kAXRoleAttribute) == "AXMenuItem" && title($0) == "Search" })
    else { return false }
    return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
}

/// Puts `box` back to holding `old`, after a paste went in where it should not have: its text is set back when it
/// can be, and otherwise the paste is undone (⌘Z once, into the app in front, only when that is `pid`). Nothing when
/// it still holds `old`.
func putBack(_ box: AXUIElement, _ old: String, pid: pid_t) {
    guard axString(box, kAXValueAttribute) != old else { return }
    var settable: DarwinBoolean = false
    if AXUIElementIsAttributeSettable(box, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue,
       AXUIElementSetAttributeValue(box, kAXValueAttribute as CFString, old as CFString) == .success {
        usleep(100_000)
        if axString(box, kAXValueAttribute) == old { return }
    }
    if frontPid() == pid { pressCommand(.z) }
}

/// The search result rows under `root` that are chats or contacts, chats first, each in the order WhatsApp shows
/// them. Found by their ids anywhere in the window, not in one list: at most 30 of each.
func waResults(_ root: AXUIElement) -> [(name: String, row: AXUIElement)] {
    var rows: [(kind: WaResult, name: String, row: AXUIElement)] = []
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 30 || rows.count >= 60 { return }
        if let kind = waResultKind(axId(e)) {
            if rows.filter({ $0.kind == kind }).count < 30 {
                rows.append((kind, chatName(axString(e, kAXDescriptionAttribute)), e))
            }
            return
        }
        for kid in axKids(e) { walk(kid, depth + 1) }
    }
    walk(root, 0)
    return chatsThenContacts(rows)
}

/// Searches WhatsApp for `name`: the chats, then the contacts, that its search shows, by name, in its order. Messages
/// found in a chat are left out. Only the search box is typed into, and nothing is opened.
func waSearch(_ pid: pid_t, _ ax: AXUIElement, _ name: String, pasteBefore: Date? = nil) throws -> [(name: String, row: AXUIElement)] {
    guard let window = whatsAppWindow(ax), let search = axFind(window, { axId($0) == waSearchBoxId }) else { throw whatsAppNotReady }
    // The name goes into the search box or nowhere: pasted into a chat's message box it would sit there as a draft.
    // What that box holds now is kept, to tell whether the paste went there.
    let composer = axFind(window, { axId($0) == waComposerId })
    let draft = composer.map { axString($0, kAXValueAttribute) } ?? ""
    let draftChanged = { composer.map { axString($0, kAXValueAttribute) != draft } ?? false }
    if !pressSearchMenu(ax) {
        guard ensureFront(pid) != nil else { throw whatsAppNotReady }
        pressCommand(.f)
    }
    usleep(300_000)
    // Too late to paste: Buddy gives up on the caller's side soon, and the clipboard must be put back before that.
    if let latest = pasteBefore, Date() >= latest { throw whatsAppNotReady }
    // Keys go to the app in front: nothing is typed unless that is WhatsApp.
    guard ensureFront(pid) != nil else { throw whatsAppNotReady }
    // Start from a clear box: rows of the last search must be gone before the new one is typed.
    let isResult = { (e: AXUIElement) in waResultKind(axId(e)) != nil }
    if !axString(search, kAXValueAttribute).isEmpty, let clear = axFind(window, { axId($0) == waClearButtonId }) {
        AXUIElementPerformAction(clear, kAXPressAction as CFString)
        let cleared = Date().addingTimeInterval(1)
        while Date() < cleared && axFind(window, isResult) != nil && !axString(search, kAXValueAttribute).isEmpty { usleep(100_000) }
        guard ensureFront(pid) != nil else { throw whatsAppNotReady }
    }
    pasteHere(name, selectAll: true)
    // WhatsApp's focus report cannot tell where the keys went (it names the window's content), but the boxes can: the
    // search box must now hold the name, and the message box what it held before.
    let wanted = singleSpaced(name)
    let typed = Date().addingTimeInterval(1.5)
    while Date() < typed && boxText(axString(search, kAXValueAttribute)) != wanted && !draftChanged() { usleep(100_000) }
    if let composer, draftChanged() {
        putBack(composer, draft, pid: pid)
        throw whatsAppNotReady
    }
    guard boxText(axString(search, kAXValueAttribute)) == wanted else { throw whatsAppNotReady }

    // The results show in their own list, within a second or so. Rows are taken only when two looks 0.3 s apart show
    // the same names, so rows of the last search that are still going away are not read.
    var shownBy = Date().addingTimeInterval(2.5)
    if let latest = pasteBefore { shownBy = min(shownBy, latest.addingTimeInterval(3.3)) }
    usleep(500_000)
    while true {
        let first = waResults(window)
        if !first.isEmpty {
            usleep(300_000)
            let second = waResults(window)
            if second.map({ $0.name }) == first.map({ $0.name }) { return second }
        }
        if Date() >= shownBy { return [] }
        usleep(200_000)
    }
}

/// waFind { name }: the chats and contacts WhatsApp's search shows for `name`, at most 10, by name (`chats`). `exact`
/// is the same list: every row is a chat or a contact now that messages found in a chat are left out (kept for
/// src/main/actions.js, which counts two chats of one name in it). Types only into the search box.
func waFind(_ args: [String: Any]) throws -> [String: Any] {
    let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw HelperError(code: "bad_request", message: "name is missing") }
    // Buddy stops waiting after 15 seconds (src/main/helper.js): no paste after 11.
    let started = Date()
    let (pid, ax) = try whatsAppReady()
    let names = try waSearch(pid, ax, name, pasteBefore: started.addingTimeInterval(11)).prefix(10).map { $0.name }
    return ["chats": names, "exact": names]
}

/// Opens a search result: a chat's row is a button; a contact's is a text, which the row around it may take the press
/// for. The first of the row and its 3 nearest parents that can be pressed is pressed. False when none took it.
func pressRow(_ row: AXUIElement) -> Bool {
    var element: AXUIElement? = row
    for _ in 0...3 {
        guard let e = element else { break }
        var actions: CFArray?
        if AXUIElementCopyActionNames(e, &actions) == .success, ((actions as? [String]) ?? []).contains(kAXPressAction) {
            return AXUIElementPerformAction(e, kAXPressAction as CFString) == .success
        }
        element = axElement(e, kAXParentAttribute)
    }
    // None says it can be pressed: the row may take it all the same.
    return AXUIElementPerformAction(row, kAXPressAction as CFString) == .success
}

/// The name in the open chat's header, "" when there is none.
func waHeader(_ ax: AXUIElement) -> String {
    whatsAppWindow(ax).map(waHeaderIn) ?? ""
}

/// The name in the header of the chat open in `window`, "" when there is none.
func waHeaderIn(_ window: AXUIElement) -> String {
    guard let header = axFind(window, { axId($0) == waHeaderId }) else { return "" }
    return chatName(axString(header, kAXDescriptionAttribute))
}

/// Opens the chat called `name` from WhatsApp's search and waits until its header says so: the header's name. Shared
/// by waSend and waCall, so a message and a call go to a chat the same way.
func waOpenChat(_ pid: pid_t, _ ax: AXUIElement, _ name: String) throws -> String {
    let same = { (other: String) in plainName(other) == plainName(name) }
    guard let row = try waSearch(pid, ax, name).first(where: { same($0.name) })?.row, pressRow(row) else { throw waChatNotFound }

    // The chat that opened must be the one asked for.
    var header = ""
    let opened = Date().addingTimeInterval(4)
    repeat {
        usleep(250_000)
        header = waHeader(ax)
    } while !same(header) && Date() < opened
    guard same(header) else { throw waWrongChat }
    return header
}

/// waSend { name, text }: opens the chat called `name`, checks its header says so, puts `text` in its message box and
/// presses Return. Return is pressed only when the box holds exactly `text`, the paste changed nothing else (the
/// search box), the header still names that chat and WhatsApp is in front; otherwise nothing is sent.
func waSend(_ args: [String: Any]) throws -> [String: Any] {
    let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let text = args["text"] as? String ?? ""
    guard !name.isEmpty, !singleSpaced(text).isEmpty else { throw HelperError(code: "bad_request", message: "name and text are needed") }
    // Buddy stops waiting after 20 seconds and stops the helper (src/main/helper.js). The paste must be over well
    // before then, so the person's clipboard is put back, and Return pressed before then too, so that a message is
    // never sent after Buddy has said it failed.
    let started = Date()
    let (pid, ax) = try whatsAppReady()
    let header = try waOpenChat(pid, ax, name)

    guard let window = whatsAppWindow(ax), let box = axFind(window, { axId($0) == waComposerId }) else { throw waNotPutIn }
    // The text goes into the message box or nowhere, never into the search box (which may still hold the name). What
    // both hold now is kept, to tell where the paste went.
    let search = axFind(window, { axId($0) == waSearchBoxId })
    let searched = search.map { axString($0, kAXValueAttribute) } ?? ""
    let searchSame = { (search.map { axString($0, kAXValueAttribute) } ?? "") == searched }
    let draft = axString(box, kAXValueAttribute)
    _ = ensureFront(pid)
    // Asked for, but not relied on: WhatsApp may answer "done" and leave the focus where it was, or name only the
    // window's content as focused. The boxes are the check, after the paste. Never while the search box says it has it.
    let focused = focusOn(box, id: waComposerId, pid: pid, in: ax)
    guard frontPid() == pid, axFocusedId(ax) != waSearchBoxId, Date().timeIntervalSince(started) < 15 else { throw waNotPutIn }
    pasteHere(text, selectAll: true)

    // Only the approved text is sent. WhatsApp may take a moment to show what was pasted.
    let wanted = singleSpaced(text)
    let holds = { singleSpaced(axString(box, kAXValueAttribute)) == wanted }
    let pasted = Date().addingTimeInterval(2)
    while !holds() && searchSame() && Date() < pasted { usleep(100_000) }
    // The paste went into the message box: it holds the text, and nothing else changed. When it held the text already,
    // only the focus report can say the paste went there.
    guard holds(), searchSame(), focused || axFocusedId(ax) == waComposerId || axString(box, kAXValueAttribute) != draft else {
        if let search, !searchSame() {
            putBack(search, searched, pid: pid)
        } else if !holds() {
            putBack(box, draft, pid: pid)
        }
        throw waNotPutIn
    }
    // Still the same chat, the paste still where it went, and WhatsApp still in front (Return goes to the app in front).
    guard waHeader(ax) == header else { throw waWrongChat }
    guard frontPid() == pid, axFocusedId(ax) != waSearchBoxId, holds(), searchSame(), Date().timeIntervalSince(started) < 17.5 else { throw waNotPutIn }
    pressKeys(.returnKey, [])
    // Sent means the box no longer holds the text. Return is never pressed again: at most 17.5 s + 1.5 s = 19 s here.
    let confirmBy = Date().addingTimeInterval(1.5)
    repeat {
        if !holds() { return ["chat": header] }
        usleep(100_000)
    } while Date() < confirmBy
    if !holds() { return ["chat": header] }
    throw HelperError(code: "not_sent", message: "I pressed Send, but WhatsApp didn't send it. Check WhatsApp.")
}

// The open chat's call buttons on WhatsApp 26.41 (seen on the owner's Mac): a one-to-one chat has a voice and a video
// button; a group has one video menu instead, and Buddy does not call groups.
let waVoiceCallId = "NavigationBar_CallButton"
let waVideoCallId = "NavigationBar_VideoCallButton"
let waGroupCallId = "NavigationBar_VideoDropdownButton"
// What shows once a call has started, not yet seen on the owner's Mac (Task 11): a window of its own for the call, or a
// new button whose name has one of these words (End, Leave, "Calling…"). Kept here, in one place.
let waCallSigns: Set<String> = ["End", "Leave", "Calling"]
// Where a sign is never looked for: the open chat's messages (a message may say "Calling"), the chat list and the
// search results (a chat may be called "Leave"). Their whole lists are skipped. Ids are whole, or end in "*" for any
// id that starts so.
let waNoSignIds = ["ChatMessagesTableView", "ChatListView_TableView", "ChatListSearchView_*"]
// Windows that are not a call: WhatsApp's own alerts.
let waNoSignWindows: Set<String> = ["AXDialog", "AXSystemDialog"]
let waNotCalled = HelperError(code: "not_called", message: "I couldn't press Call. Call from WhatsApp yourself.")

/// Whether no call sign is looked for in the element with the id `id`, or under it (waNoSignIds).
func waNoSign(_ id: String) -> Bool {
    !id.isEmpty && waNoSignIds.contains { $0.hasSuffix("*") ? id.hasPrefix(String($0.dropLast())) : id == $0 }
}

/// How many signs of a call WhatsApp shows now: its windows that are not alerts, and the buttons in them (30 deep, at
/// most 600 elements looked at in each, the skipped lists not walked) whose name or title has one of `waCallSigns` as
/// a whole word. Only a rise after the press counts, so the ones that were there before do not.
func waCallSignCount(_ ax: AXUIElement) -> Int {
    let windows = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let isSign = { (text: String) in
        !waCallSigns.isDisjoint(with: withoutMarks(text).components(separatedBy: CharacterSet.letters.inverted))
    }
    var signs = 0
    for window in windows {
        if axString(window, kAXRoleAttribute) == "AXWindow", !waNoSignWindows.contains(axString(window, kAXSubroleAttribute)) {
            signs += 1
        }
        var looked = 0
        func walk(_ e: AXUIElement, _ depth: Int) {
            if looked >= 600 || waNoSign(axId(e)) { return }
            looked += 1
            if axString(e, kAXRoleAttribute) == "AXButton",
               isSign(axString(e, kAXDescriptionAttribute)) || isSign(axString(e, kAXTitleAttribute)) {
                signs += 1
            }
            if depth >= 30 { return }
            for kid in axKids(e) { walk(kid, depth + 1) }
        }
        walk(window, 0)
    }
    return signs
}

/// waCall { name, video }: opens the chat called `name` (as waSend does), checks its header, and presses its voice or
/// video call button, once. A group's call menu is never pressed. Called means a sign of the call (waCallSignCount)
/// showed within 4 seconds of the press. Once the press is tried, any other end is `call_unsure` and nothing is pressed
/// again; only a press WhatsApp's button certainly did not take (it has no press, or is gone) is `not_called`. Nothing
/// is pressed after 15 seconds: Buddy gives up at 20 (src/main/helper.js).
func waCall(_ args: [String: Any]) throws -> [String: Any] {
    let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let video = args["video"] as? Bool ?? false
    guard !name.isEmpty else { throw HelperError(code: "bad_request", message: "name is missing") }
    let started = Date()
    let pid: pid_t
    let ax: AXUIElement
    let header: String
    do {
        (pid, ax) = try whatsAppReady()
        header = try waOpenChat(pid, ax, name)
    } catch let error as HelperError where error.code == "no_whatsapp" {
        throw HelperError(code: "no_whatsapp", message: "Install WhatsApp for Mac and I can call from here.")
    } catch let error as HelperError where error.code == "wrong_chat" {
        throw HelperError(code: "wrong_chat", message: "That opened the wrong chat, so I didn't call.")
    }
    guard let window = whatsAppWindow(ax) else { throw waNotCalled }
    if axFind(window, { axId($0) == waGroupCallId }) != nil {
        throw HelperError(code: "group_call", message: "I can only call one person, not a group. Call from WhatsApp yourself.")
    }
    let wanted = video ? waVideoCallId : waVoiceCallId
    guard let button = axFind(window, { axId($0) == wanted }) else { throw waNotCalled }
    let before = waCallSignCount(ax)
    // Still that chat in the window the button is in, WhatsApp in front, and time left.
    guard waHeaderIn(window) == header, frontPid() == pid, Date().timeIntervalSince(started) < 15 else { throw waNotCalled }
    let pressed = AXUIElementPerformAction(button, kAXPressAction as CFString)
    // Tried: from here on nothing is pressed again, whatever happens. Only these two say the press did nothing; any
    // other error (WhatsApp slow to answer, say) may come with a press that landed, so the signs are looked for.
    if pressed == .actionUnsupported || pressed == .invalidUIElement { throw waNotCalled }
    // The answer comes before Buddy's 20 seconds.
    let by = min(Date().addingTimeInterval(4), started.addingTimeInterval(18.5))
    repeat {
        usleep(400_000)
        if waCallSignCount(ax) > before { return ["chat": header] }
    } while Date() < by
    throw HelperError(code: "call_unsure", message: "I'm not sure the call started. Check WhatsApp.")
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
        case "notch":
            result = notchInfo()
        case "watchKeys":
            result = try watchKeys(args)
        case "watchTyping":
            result = try watchTyping(args)
        case "waFind":
            result = try waFind(args)
        case "waSend":
            result = try waSend(args)
        case "waCall":
            result = try waCall(args)
        case "axTree":
            result = try axTree(args)
        case "axAct":
            result = try axAct(args)
        case "menu":
            result = try menu(args)
        case "click":
            result = try click(args)
        case "drag":
            result = try drag(args)
        case "scroll":
            result = try scroll(args)
        case "keys":
            result = try keys(args)
        case "typeText":
            result = try typeText(args)
        case "screenshotScreen":
            result = try screenshotScreen(args)
        case "watchStop":
            result = try watchStop(args)
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

// MARK: - the computer agent's hands (docs/superpowers/specs/2026-10-18-computer-agent-design.md §6.5)
//
// The tree of the front window, acts on its elements by the ids of the last tree, the menu bar, the mouse, keys and
// text, a picture of the whole screen without Buddy's own windows, and a listen-only tap that says when the person
// presses Esc or takes over. Nothing here logs what it reads. Every event the helper posts carries buddyEventMark, so
// that the stop tap knows its own.

let buddyEventMark: Int64 = 0x42554459 // "BUDY"
let axTreeLock = NSLock()
var axTreeGen = 0
var axTreePid: pid_t = 0
var axTreeRefs: [String: AXUIElement] = [:]
let flattenRoles: Set<String> = ["AXGroup", "AXScrollArea", "AXSplitGroup", "AXLayoutArea", "AXUnknown"]

func markOwn(_ event: CGEvent?) {
    event?.setIntegerValueField(.eventSourceUserData, value: buddyEventMark)
}

final class DictBox: @unchecked Sendable {
    var value: Result<[String: Any], Error>?
}

/// The strict check for the agent's typing: true for a password field, and when the focused field cannot be told at
/// all it refuses (focus_unknown), unlike focusedIsSecure above, which stays lenient for Fix and paste.
func strictFocusSecure(_ pid: pid_t) throws -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1.0)
    guard let element = axElement(app, kAXFocusedUIElementAttribute) else {
        throw HelperError(code: "focus_unknown", message: "I can't tell where the cursor is, so I didn't type.")
    }
    return axIsSecure(element)
}

func axFrame(_ e: AXUIElement) -> CGRect? {
    guard let p = axAttr(e, kAXPositionAttribute), let s = axAttr(e, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(s as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

func axValueText(_ e: AXUIElement) -> String? {
    guard let v = axAttr(e, kAXValueAttribute) else { return nil }
    if let s = v as? String { return s.isEmpty ? nil : s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
}

func axIsSecure(_ e: AXUIElement) -> Bool {
    axString(e, kAXRoleAttribute) == "AXSecureTextField" || axString(e, kAXSubroleAttribute) == "AXSecureTextField"
}

func sameTitle(_ a: String, _ b: String) -> Bool {
    let norm = { (s: String) in s.replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "")
        .trimmingCharacters(in: .whitespaces).lowercased() }
    return !a.isEmpty && norm(a) == norm(b)
}

func axTree(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    let maxNodes = min(max(args["maxNodes"] as? Int ?? 600, 1), 2000)
    let maxDepth = min(max(args["maxDepth"] as? Int ?? 25, 1), 40)
    let app = AXUIElementCreateApplication(pid)
    guard let window = axElement(app, kAXFocusedWindowAttribute) ?? axElement(app, kAXMainWindowAttribute) else {
        axTreeLock.lock()
        axTreeGen += 1
        axTreeRefs = [:]
        axTreeLock.unlock()
        return ["gen": axTreeGen, "title": "", "nodes": [], "focused": NSNull(), "secureFocused": false, "truncated": false]
    }
    let focusedElement = axElement(app, kAXFocusedUIElementAttribute)
    let deadline = Date().addingTimeInterval(5)
    var truncated = false
    let windowFrame = axFrame(window)
    var displayIds = [CGDirectDisplayID](repeating: 0, count: 16)
    var displayCount: UInt32 = 0
    CGGetActiveDisplayList(16, &displayIds, &displayCount)
    let displayRects = displayIds.prefix(Int(displayCount)).map { CGDisplayBounds($0) }
    var refs: [String: AXUIElement] = [:]
    var nodes: [[String: Any]] = []
    var focusedId: String?
    func walk(_ e: AXUIElement, _ depth: Int) {
        if nodes.count >= maxNodes || depth > maxDepth || truncated { return }
        if Date() > deadline { truncated = true; return }
        let role = axString(e, kAXRoleAttribute)
        let name = [axString(e, kAXTitleAttribute), axString(e, kAXDescriptionAttribute), axString(e, "AXPlaceholderValue"),
                    axString(e, kAXHelpAttribute)].first { !$0.isEmpty } ?? ""
        let frame = axFrame(e)
        let visible = frame.map { f in
            f.width > 0 && f.height > 0 && (windowFrame.map { f.intersects($0) } ?? true)
                && (displayRects.isEmpty || displayRects.contains { f.intersects($0) })
        } ?? true
        if !visible { return }
        var childDepth = depth
        if !role.isEmpty && !(name.isEmpty && flattenRoles.contains(role)) {
            let id = "e\(nodes.count + 1)"
            refs[id] = e
            let secure = axIsSecure(e)
            var node: [String: Any] = ["id": id, "role": role, "subrole": axString(e, kAXSubroleAttribute),
                                       "name": String(name.prefix(200)), "depth": depth]
            if secure { node["secure"] = true } else if let value = axValueText(e) { node["value"] = String(value.prefix(300)) }
            if let enabled = axAttr(e, kAXEnabledAttribute) as? Bool, !enabled { node["disabled"] = true }
            if let selected = axAttr(e, kAXSelectedAttribute) as? Bool, selected { node["selected"] = true }
            if let f = frame { node["frame"] = ["x": f.minX, "y": f.minY, "width": f.width, "height": f.height] }
            if let focusedElement, CFEqual(focusedElement, e) { focusedId = id }
            nodes.append(node)
            childDepth = depth + 1
        }
        for kid in axKids(e) { walk(kid, childDepth) }
    }
    walk(window, 0)
    axTreeLock.lock()
    axTreeGen += 1
    let gen = axTreeGen
    axTreeRefs = refs
    axTreePid = pid
    axTreeLock.unlock()
    let secureFocused = focusedElement.map(axIsSecure) ?? false
    return ["gen": gen, "title": axString(window, kAXTitleAttribute), "nodes": nodes,
            "focused": focusedId ?? NSNull(), "secureFocused": secureFocused, "truncated": truncated]
}

func axRef(_ args: [String: Any], pid: pid_t) throws -> AXUIElement {
    guard let gen = args["gen"] as? Int, let id = args["id"] as? String else {
        throw HelperError(code: "bad_request", message: "gen and id are required")
    }
    axTreeLock.lock()
    defer { axTreeLock.unlock() }
    guard pid == axTreePid else { throw HelperError(code: "stale", message: "That is a different app now. Look again.") }
    guard gen == axTreeGen, let e = axTreeRefs[id] else {
        throw HelperError(code: "stale_id", message: "That is not on the screen any more. Look again.")
    }
    return e
}

func postClick(_ point: CGPoint, right: Bool = false, count: Int = 1) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let button: CGMouseButton = right ? .right : .left
    let downType: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let upType: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: button)
    markOwn(move)
    move?.post(tap: .cghidEventTap)
    for n in 1...max(1, min(count, 3)) {
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
        markOwn(down)
        markOwn(up)
        down?.post(tap: .cghidEventTap)
        usleep(30_000)
        up?.post(tap: .cghidEventTap)
        usleep(60_000)
    }
}

func clickCentre(_ e: AXUIElement) throws {
    guard let f = axFrame(e) else { throw HelperError(code: "no_frame", message: "I couldn't find where that is.") }
    postClick(CGPoint(x: f.midX, y: f.midY))
}

func press(_ e: AXUIElement) throws {
    if AXUIElementPerformAction(e, kAXPressAction as CFString) != .success { try clickCentre(e) }
}

func postKey(_ code: CGKeyCode, _ flags: CGEventFlags) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    down?.flags = flags
    up?.flags = flags
    markOwn(down)
    markOwn(up)
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func pick(_ e: AXUIElement, _ option: String) throws {
    let role = axString(e, kAXRoleAttribute)
    if ["AXPopUpButton", "AXComboBox", "AXMenuButton"].contains(role) {
        try press(e)
        usleep(300_000)
        let menu = axFind(e) { axString($0, kAXRoleAttribute) == "AXMenu" } ?? e
        guard let item = axFind(menu, { axString($0, kAXRoleAttribute) == "AXMenuItem" && sameTitle(axString($0, kAXTitleAttribute), option) }) else {
            postKey(0x35, []) // Esc closes the menu that was opened
            throw HelperError(code: "no_option", message: "There is no choice \"\(option)\" there.")
        }
        if AXUIElementPerformAction(item, kAXPressAction as CFString) != .success {
            throw HelperError(code: "press_failed", message: "I couldn't choose \"\(option)\".")
        }
        return
    }
    if AXUIElementSetAttributeValue(e, kAXSelectedAttribute as CFString, kCFBooleanTrue) != .success { try press(e) }
}

func axAct(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    let e = try axRef(args, pid: pid)
    guard ensureFront(pid) != nil else { throw HelperError(code: "not_frontmost", message: "Could not switch to that app.") }
    switch args["op"] as? String ?? "" {
    case "press":
        try press(e)
    case "setValue":
        if axIsSecure(e) { throw HelperError(code: "secure_field", message: "I don't type into password fields.") }
        guard let text = args["value"] as? String else { throw HelperError(code: "bad_request", message: "value is required") }
        if AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, text as CFTypeRef) != .success {
            throw HelperError(code: "not_settable", message: "I couldn't type there.")
        }
    case "focus":
        if AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue) != .success {
            return ["ok": false, "error": "focus_failed"]
        }
    case "toggle":
        let want = args["value"] as? Bool ?? true
        let isOn = (axAttr(e, kAXValueAttribute) as? NSNumber)?.intValue == 1
        if isOn != want { try press(e) }
    case "pick":
        guard let option = args["value"] as? String else { throw HelperError(code: "bad_request", message: "value is required") }
        try pick(e, option)
    default:
        throw HelperError(code: "bad_request", message: "op must be press, setValue, focus, toggle or pick")
    }
    return ["ok": true]
}

func menu(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    guard let path = args["path"] as? [String], !path.isEmpty, path.count <= 6 else {
        throw HelperError(code: "bad_request", message: "path must be 1 to 6 menu titles")
    }
    guard ensureFront(pid) != nil else { throw HelperError(code: "not_frontmost", message: "Could not switch to that app.") }
    guard var current = axElement(AXUIElementCreateApplication(pid), kAXMenuBarAttribute) else {
        throw HelperError(code: "no_menu", message: "This app has no menu bar.")
    }
    for (i, title) in path.enumerated() {
        let items = axKids(current).flatMap { kid -> [AXUIElement] in
            axString(kid, kAXRoleAttribute) == "AXMenu" ? axKids(kid) : [kid]
        }
        guard let item = items.first(where: { sameTitle(axString($0, kAXTitleAttribute), title) }) else {
            throw HelperError(code: "no_menu_item", message: "There is no menu item \"\(title)\".")
        }
        if i == path.count - 1 {
            if let enabled = axAttr(item, kAXEnabledAttribute) as? Bool, !enabled {
                throw HelperError(code: "disabled", message: "\"\(title)\" can't be used right now.")
            }
            if AXUIElementPerformAction(item, kAXPressAction as CFString) != .success {
                return ["ok": false, "error": "press_failed"]
            }
        } else {
            current = item
        }
    }
    return ["ok": true]
}

func pointArg(_ value: Any?) throws -> CGPoint {
    guard let p = value as? [String: Any], let x = (p["x"] as? NSNumber)?.doubleValue, let y = (p["y"] as? NSNumber)?.doubleValue else {
        throw HelperError(code: "bad_request", message: "a point needs x and y")
    }
    return CGPoint(x: x, y: y)
}

func click(_ args: [String: Any]) throws -> [String: Any] {
    try needAccessibility()
    let point = try pointArg(args)
    var hit: AXUIElement?
    if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
       let hit, axIsSecure(hit) {
        throw HelperError(code: "secure_field", message: "I don't click into password fields.")
    }
    postClick(point, right: args["right"] as? Bool == true, count: args["count"] as? Int ?? 1)
    return ["ok": true]
}

func drag(_ args: [String: Any]) throws -> [String: Any] {
    try needAccessibility()
    let from = try pointArg(args["from"])
    let to = try pointArg(args["to"])
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)
    markOwn(down)
    down?.post(tap: .cghidEventTap)
    usleep(60_000)
    for n in 1...10 {
        let t = CGFloat(n) / 10
        let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        let moved = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)
        markOwn(moved)
        moved?.post(tap: .cghidEventTap)
        usleep(20_000)
    }
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)
    markOwn(up)
    up?.post(tap: .cghidEventTap)
    return ["ok": true]
}

func scroll(_ args: [String: Any]) throws -> [String: Any] {
    try needAccessibility()
    let point = try pointArg(args)
    let lines: Int32 = 5
    let dir = args["dir"] as? String ?? "down"
    let dy: Int32 = dir == "up" ? lines : dir == "down" ? -lines : 0
    let dx: Int32 = dir == "left" ? lines : dir == "right" ? -lines : 0
    let source = CGEventSource(stateID: .combinedSessionState)
    let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
    markOwn(move)
    move?.post(tap: .cghidEventTap)
    let wheel = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
    markOwn(wheel)
    wheel?.post(tap: .cghidEventTap)
    return ["ok": true]
}

let namedKeys: [String: CGKeyCode] = [
    "enter": 0x24, "return": 0x24, "tab": 0x30, "space": 0x31, "delete": 0x33, "backspace": 0x33, "esc": 0x35,
    "escape": 0x35, "forwarddelete": 0x75, "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79, "left": 0x7B,
    "right": 0x7C, "down": 0x7D, "up": 0x7E, "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
    "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
]
// Where an American keyboard has each character: only used when the person's own layout has no key for it.
let usKeys: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09,
    "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
    "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18, "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E,
    "o": 0x1F, "u": 0x20, "[": 0x21, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "'": 0x27, "k": 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, "n": 0x2D, "m": 0x2E, ".": 0x2F, "`": 0x32,
]
let comboModifiers: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand, "ctrl": .maskControl, "control": .maskControl, "alt": .maskAlternate,
    "option": .maskAlternate, "opt": .maskAlternate, "shift": .maskShift, "fn": .maskSecondaryFn,
]

/// The key that types `char` in the person's layout (or the shortcut layout), as keyCode(_:_:) looks a letter up.
func layoutKeyCode(_ char: String, command: Bool) -> CGKeyCode? {
    let lookUp = { () -> CGKeyCode? in
        let layouts: [() -> Unmanaged<TISInputSource>?] = [
            TISCopyCurrentKeyboardLayoutInputSource, TISCopyCurrentASCIICapableKeyboardLayoutInputSource,
        ]
        for copy in layouts {
            guard let source = copy()?.takeRetainedValue() else { continue }
            if let code = keyCode(typing: char, in: source, command: command) { return code }
        }
        return nil
    }
    return Thread.isMainThread ? lookUp() : DispatchQueue.main.sync(execute: lookUp)
}

func keys(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    guard let combo = args["combo"] as? String, !combo.isEmpty, combo.count <= 40 else {
        throw HelperError(code: "bad_request", message: "combo is required")
    }
    var flags: CGEventFlags = []
    var code: CGKeyCode?
    for part in combo.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
        if let flag = comboModifiers[part] { flags.insert(flag); continue }
        guard code == nil else { throw HelperError(code: "bad_request", message: "One key at a time.") }
        code = namedKeys[part] ?? (part.count == 1 ? (layoutKeyCode(part, command: flags.contains(.maskCommand)) ?? usKeys[part]) : nil)
        if code == nil { throw HelperError(code: "bad_request", message: "Unknown key: \(part)") }
    }
    guard let key = code else { throw HelperError(code: "bad_request", message: "No key in the combo.") }
    guard ensureFront(pid) != nil else { throw HelperError(code: "not_frontmost", message: "Could not switch to that app.") }
    if try strictFocusSecure(pid) && !(flags.isEmpty && [0x24, 0x30, 0x35].contains(key)) {
        throw HelperError(code: "secure_field", message: "I don't type into password fields.")
    }
    postKey(key, flags)
    return ["ok": true]
}

func typeText(_ args: [String: Any]) throws -> [String: Any] {
    let pid = try pidArg(args)
    try needAccessibility()
    guard let text = args["text"] as? String, !text.isEmpty, text.count <= 4000 else {
        throw HelperError(code: "bad_request", message: "text is required")
    }
    guard ensureFront(pid) != nil else { throw HelperError(code: "not_frontmost", message: "Could not switch to that app.") }
    let source = CGEventSource(stateID: .combinedSessionState)
    let clean = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        .replacingOccurrences(of: "\t", with: " ")
    for (n, line) in clean.components(separatedBy: "\n").enumerated() {
        if try strictFocusSecure(pid) { throw HelperError(code: "secure_field", message: "I don't type into password fields.") }
        if n > 0 { postKey(0x24, .maskShift) } // Shift+Return: a new line, which a chat app does not take as Send
        // Chunks of at most 20 UTF-16 units, never splitting a character.
        var chunks: [[UInt16]] = []
        var current: [UInt16] = []
        for ch in line {
            let units = Array(String(ch).utf16)
            if current.count + units.count > 20 { chunks.append(current); current = [] }
            current += units
        }
        if !current.isEmpty { chunks.append(current) }
        for chunk in chunks {
            if try strictFocusSecure(pid) { throw HelperError(code: "secure_field", message: "I don't type into password fields.") }
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            chunk.withUnsafeBufferPointer { p in
                down?.keyboardSetUnicodeString(stringLength: p.count, unicodeString: p.baseAddress)
                up?.keyboardSetUnicodeString(stringLength: p.count, unicodeString: p.baseAddress)
            }
            markOwn(down)
            markOwn(up)
            down?.post(tap: .cghidEventTap)
            up?.post(tap: .cghidEventTap)
            usleep(12_000)
        }
    }
    return ["ok": true]
}

func captureScreen(pid: pid_t?, maxEdge: Int) async throws -> [String: Any] {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    var display = content.displays.first
    if let pid, let windowId = frontWindowId(pid), let window = content.windows.first(where: { $0.windowID == windowId }) {
        display = content.displays.first(where: { $0.frame.intersects(window.frame) }) ?? display
    }
    guard let display else { throw HelperError(code: "no_window", message: "No screen to capture.") }
    let own = content.applications.filter { $0.processID == ownerPid || $0.processID == getpid() }
    let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
    let scale = CGFloat(filter.pointPixelScale)
    var width = display.frame.width * scale
    var height = display.frame.height * scale
    let longEdge = max(width, height)
    if longEdge > CGFloat(maxEdge) {
        width *= CGFloat(maxEdge) / longEdge
        height *= CGFloat(maxEdge) / longEdge
    }
    let config = SCStreamConfiguration()
    config.width = Int(width)
    config.height = Int(height)
    config.showsCursor = false
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    guard let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else {
        throw HelperError(code: "capture_failed", message: "Could not encode the screenshot.")
    }
    return ["image": jpeg.base64EncodedString(), "width": Int(width), "height": Int(height),
            "origin": ["x": display.frame.minX, "y": display.frame.minY],
            "pointsPerPixel": display.frame.width / CGFloat(Int(width))]
}

func screenshotScreen(_ args: [String: Any]) throws -> [String: Any] {
    if !CGPreflightScreenCaptureAccess() {
        throw HelperError(code: "no_screen_recording", message: "Buddy needs Screen Recording permission to see your screen. Open Settings (⚙︎) to allow it.")
    }
    let pid = (args["pid"] as? Int).map { pid_t($0) }
    let maxEdge = min(max(args["maxEdge"] as? Int ?? 1280, 320), 1568)
    let box = DictBox()
    let done = DispatchSemaphore(value: 0)
    Task {
        do { box.value = .success(try await captureScreen(pid: pid, maxEdge: maxEdge)) } catch { box.value = .failure(error) }
        done.signal()
    }
    done.wait()
    switch box.value {
    case .success(let value): return value
    case .failure(let error as HelperError): throw error
    case .failure(let error):
        logLine("the screen capture failed: \(error.localizedDescription)")
        throw HelperError(code: "capture_failed", message: "Could not take the screenshot. Try again.")
    case nil: throw HelperError(code: "capture_failed", message: "No screenshot.")
    }
}

var stopTap: CFMachPort?

func ownWindowAt(_ point: CGPoint) -> Bool {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return false }
    for info in list {
        guard let bounds = info[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(point),
              (info[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
        let owner = info[kCGWindowOwnerPID as String] as? Int ?? 0
        return owner == Int(ownerPid) || owner == Int(getpid())
    }
    return false
}

func onStopEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = stopTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == buddyEventMark { return Unmanaged.passUnretained(event) }
    if type == .keyDown {
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        if event.getIntegerValueField(.keyboardEventKeycode) == 0x35 { send(["event": "esc"]) }
        else if front != ownerPid && front != getpid() { send(["event": "took_over"]) }
    } else if (type == .leftMouseDown || type == .rightMouseDown) && !ownWindowAt(event.location) {
        send(["event": "took_over"])
    }
    return Unmanaged.passUnretained(event)
}

func watchStop(_ args: [String: Any]) throws -> [String: Any] {
    let on = args["on"] as? Bool == true
    if on { try needAccessibility() }
    let change = { () -> Bool in
        if on {
            if stopTap != nil { return true }
            let mask = CGEventMask(1 << CGEventType.keyDown.rawValue) | CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
                | CGEventMask(1 << CGEventType.rightMouseDown.rawValue)
            guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                              eventsOfInterest: mask, callback: onStopEvent, userInfo: nil) else { return false }
            CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            stopTap = tap
            return true
        }
        if let tap = stopTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
            stopTap = nil
        }
        return true
    }
    let ok = Thread.isMainThread ? change() : DispatchQueue.main.sync(execute: change)
    if !ok { throw HelperError(code: "no_accessibility", message: "Buddy needs Accessibility permission to hear Esc.") }
    return ["on": on]
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
