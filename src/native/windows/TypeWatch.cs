// Buddy where you type (watchTyping): the person writes in any app and ends with a tag, "@buddy" or their buddy's own
// name ("@aarav"), and what to do ("@buddy fix", "@aarav formal"). While the watch is on, a keyboard hook keeps the
// last characters they typed; when those hold a tag and the person pauses, Buddy is told which app it is in:
//
//   {"event": "tag", "pid": 123}
//
// Buddy then reads the paragraph (captureSelection with "select": "paragraph"), has it rewritten and pastes the answer
// over it. A tag follows the rules of shared/tag.js: "@" and one of the names, with no letter, digit, "_" or "@" just
// before it (so an email address is not a tag) and no letter, digit or "_" just after it ("@buddyx" is not one).
//
// What the person types stays in this process's memory, only while it could still end in a tag, and goes the moment
// they press Enter, move the caret, click or switch windows. It is never logged and never sent: only the app's pid is.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace BuddyHelper
{
    static class TypeWatch
    {
        const int Keep = 120; // characters: the tag and what to do, with room to spare
        const int PauseMs = 1200; // how long the person stops typing before Buddy takes over

        // A name as shared/tag.js takes one (tagNames): one word of letters, digits or "_".
        static readonly Regex NamePattern = new Regex(@"^[\p{L}\p{N}_]{2,24}\z");
        static readonly int OwnPid = Process.GetCurrentProcess().Id;

        // Everything below is shared by the hook's thread, the pause timer's and the command's: under Lock.
        static readonly object Lock = new object();
        static readonly StringBuilder Typed = new StringBuilder();
        static string[] names = new string[0];
        static bool watching;
        static IntPtr typedIn; // the window the typing went to
        static int keys; // goes up with every key and every clear, so a pause that ended meanwhile is told apart
        static Timer pause;

        // The hooks' thread, and its callbacks, kept here so that the garbage collector leaves them alone.
        static Thread thread;
        static uint threadId;
        static Native.LowLevelProc onKey;
        static Native.LowLevelProc onMouse;
        static Native.WinEventProc onForeground;

        /// watchTyping: {"on": true, "names": ["buddy", "aarav"]} starts the watch (or changes its names, when it is on
        /// already); {"on": false} stops it and forgets what was typed.
        public static Dictionary<string, object> Watch(Dictionary<string, object> args)
        {
            object on = Program.Get(args, "on");
            if (!(on is bool) || !(bool)on)
            {
                Stop();
                return Program.Obj("watching", false);
            }
            string[] given = NamesArg(args);
            lock (Lock)
            {
                names = given;
                ClearTyped();
            }
            Start();
            return Program.Obj("watching", true);
        }

        /// The names, 1 to 4 words of letters, digits or "_", each 2 to 24 long, in lower case.
        static string[] NamesArg(Dictionary<string, object> args)
        {
            const string wrong = "names must be 1 to 4 words";
            // A JSON list arrives as object[].
            var list = Program.Get(args, "names") as System.Collections.IList;
            if (list == null || list.Count < 1 || list.Count > 4) throw new HelperError("bad_request", wrong);
            var found = new List<string>();
            foreach (object item in list)
            {
                string name = item as string;
                if (name == null || !NamePattern.IsMatch(name)) throw new HelperError("bad_request", wrong);
                name = name.ToLowerInvariant();
                if (!found.Contains(name)) found.Add(name);
            }
            return found.ToArray();
        }

        /// The hooks live on a thread of their own, whose message loop delivers them: the work thread may wait on an app
        /// for a second, and Windows drops a keyboard hook that keeps every key of the person's waiting.
        static void Start()
        {
            if (thread != null) return;
            var ready = new ManualResetEvent(false);
            bool started = false;
            var run = new Thread(delegate()
            {
                IntPtr keyHook = IntPtr.Zero, mouseHook = IntPtr.Zero, foregroundHook = IntPtr.Zero;
                try
                {
                    threadId = Native.GetCurrentThreadId();
                    IntPtr module = Native.GetModuleHandle(null);
                    keyHook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, onKey, module, 0);
                    if (keyHook == IntPtr.Zero)
                    {
                        Program.Log("could not watch the keys (error " + Marshal.GetLastWin32Error() + ")");
                        return;
                    }
                    // Without these two the watch still works, only less carefully: what was typed is then also
                    // forgotten at the next key in another window (OnKey).
                    mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, onMouse, module, 0);
                    if (mouseHook == IntPtr.Zero) Program.Log("could not watch the clicks (error " + Marshal.GetLastWin32Error() + ")");
                    foregroundHook = Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND,
                        IntPtr.Zero, onForeground, 0, 0, Native.WINEVENT_OUTOFCONTEXT);
                    if (foregroundHook == IntPtr.Zero) Program.Log("could not watch for another window in front while watching the keys");
                    started = true;
                    ready.Set();
                    // The hooks are called inside GetMessage; nothing else comes to this thread but the WM_QUIT of Stop.
                    Native.MSG message;
                    while (Native.GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
                    {
                    }
                }
                finally
                {
                    if (foregroundHook != IntPtr.Zero) Native.UnhookWinEvent(foregroundHook);
                    if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
                    if (keyHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyHook);
                    ready.Set();
                }
            });
            onKey = OnKey;
            onMouse = OnMouse;
            onForeground = OnForeground;
            lock (Lock)
            {
                if (pause == null) pause = new Timer(OnPause, null, Timeout.Infinite, Timeout.Infinite);
                watching = true;
            }
            run.IsBackground = true;
            // Windows gives a keyboard hook little time before it skips it, and then drops it.
            run.Priority = ThreadPriority.AboveNormal;
            run.Start();
            ready.WaitOne(2000);
            if (!started)
            {
                // A thread too slow to start must not go on watching once this has given up on it.
                if (threadId != 0) Native.PostThreadMessage(threadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
                lock (Lock) watching = false;
                throw new HelperError("failed", "Something went wrong. Try again.");
            }
            thread = run;
        }

        static void Stop()
        {
            lock (Lock)
            {
                watching = false;
                ClearTyped();
            }
            if (thread == null) return;
            Native.PostThreadMessage(threadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
            if (!thread.Join(1000)) Program.Log("the key watch did not stop within a second");
            thread = null;
        }

        static IntPtr OnKey(int code, IntPtr message, IntPtr data)
        {
            if (code >= 0)
            {
                try
                {
                    int kind = message.ToInt32();
                    if (kind == Native.WM_KEYDOWN || kind == Native.WM_SYSKEYDOWN)
                    {
                        var key = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(Native.KBDLLHOOKSTRUCT));
                        // Keys a program sent are not the person typing: Buddy's own Ctrl+C and Ctrl+V, or a paste.
                        if ((key.flags & Native.LLKHF_INJECTED) == 0) Typing((int)key.vkCode, key.scanCode);
                    }
                }
                catch (Exception e)
                {
                    Program.Log("could not read a key: " + Program.Describe(e));
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, message, data);
        }

        /// A click may move the caret anywhere: what was typed no longer ends where the person writes.
        static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
        {
            if (code >= 0)
            {
                int kind = message.ToInt32();
                if (kind == Native.WM_LBUTTONDOWN || kind == Native.WM_RBUTTONDOWN || kind == Native.WM_MBUTTONDOWN
                    || kind == Native.WM_XBUTTONDOWN)
                {
                    var click = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(Native.MSLLHOOKSTRUCT));
                    // Buddy's own input event that does nothing (KeyInput.Nothing) is not a click.
                    if ((click.flags & Native.LLMHF_INJECTED) == 0)
                    {
                        lock (Lock) ClearTyped();
                    }
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, message, data);
        }

        static void OnForeground(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint eventThread, uint time)
        {
            lock (Lock) ClearTyped();
        }

        /// One key the person pressed, `vk` with the scan code `scan`: a character adds to what was typed, Backspace
        /// takes one away, and anything that may move the caret or do something else clears it all.
        static void Typing(int vk, uint scan)
        {
            // Shift, Ctrl, Alt, the Windows keys and the locks on their own do nothing yet; Delete takes away what is
            // after the caret, not before it; the volume and media keys and an input method's own keys type nothing.
            if (IsModifier(vk) || vk == 0x2E || (vk >= 0xAD && vk <= 0xB3) || KeyInput.IsInputMethodKey(vk)) return;
            bool ctrl = Down(0x11), alt = Down(0x12), windows = Down(0x5B) || Down(0x5C);
            string typed = null; // null: clear, "": nothing to add yet
            if (vk == 0x08)
            {
                // Backspace; with Ctrl it takes away a whole word, which is not worth following.
                if (!ctrl && !alt && !windows) typed = "\b";
            }
            // A shortcut (Ctrl+V, Alt+Tab, Win+D) clears. Right Alt (AltGr) reads as Ctrl and Alt together, and on many
            // keyboards (German, French, Polish) it is how "@" is typed: Ctrl with Alt counts as typing when the
            // keyboard gives a character for it.
            else if (!windows && ctrl == alt)
            {
                typed = Translate(vk, scan, ctrl);
            }

            IntPtr window = Native.GetForegroundWindow();
            lock (Lock)
            {
                if (!watching) return;
                // Another window, as the foreground hook should have said already.
                if (window != typedIn)
                {
                    ClearTyped();
                    typedIn = window;
                }
                if (typed == null)
                {
                    ClearTyped();
                    return;
                }
                if (typed == "") return;
                if (typed == "\b")
                {
                    int cut = Typed.Length >= 2 && char.IsLowSurrogate(Typed[Typed.Length - 1]) ? 2 : 1;
                    if (Typed.Length >= cut) Typed.Length -= cut;
                }
                else
                {
                    Typed.Append(typed);
                    if (Typed.Length > Keep) Typed.Remove(0, Typed.Length - Keep);
                }
                keys++;
                // Every key starts the pause again, while there is a tag to act on.
                pause.Change(HasTag() ? PauseMs : Timeout.Infinite, Timeout.Infinite);
            }
        }

        /// What the key types in the window in front's keyboard layout: its characters, "" for a dead key (an accent, which
        /// waits for the next key), or null for a key that types nothing (Enter, Esc, Tab, the arrows, Home, End,
        /// Page Up and Down, F1 to F12, or Ctrl with Alt where the keyboard has nothing for it).
        static string Translate(int vk, uint scan, bool altGr)
        {
            // This thread's own idea of the keyboard is not the person's: their modifiers and locks are read here.
            var state = new byte[256];
            if (Down(0x10)) state[0x10] = 0x80; // Shift
            if (altGr)
            {
                state[0x11] = 0x80; // Ctrl
                state[0x12] = 0x80; // Alt
            }
            if ((Native.GetKeyState(0x14) & 1) != 0) state[0x14] = 0x01; // Caps Lock on
            if ((Native.GetKeyState(0x90) & 1) != 0) state[0x90] = 0x01; // Num Lock on
            uint unused;
            IntPtr layout = Native.GetKeyboardLayout(Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out unused));
            var buffer = new char[8];
            int count = Native.ToUnicodeEx((uint)vk, scan, state, buffer, buffer.Length, Native.TOUNICODE_KEEP_STATE, layout);
            if (count < 0) return "";
            if (count == 0) return null;
            for (int i = 0; i < count; i++)
            {
                // Enter, Tab, Esc and Backspace's own character are not text.
                if (char.IsControl(buffer[i])) return null;
            }
            return new string(buffer, 0, count);
        }

        static bool IsModifier(int vk)
        {
            return (vk >= 0x10 && vk <= 0x12) || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C
                || vk == 0x14 || vk == 0x90 || vk == 0x91;
        }

        static bool Down(int vk)
        {
            return (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
        }

        /// The person has stopped typing with a tag in what they typed: tell Buddy, unless it is somewhere Buddy must
        /// not type. On a thread of the pool, as the questions below can take up to a second.
        static void OnPause(object unused)
        {
            try
            {
                int seen;
                IntPtr window;
                lock (Lock)
                {
                    if (!watching || !HasTag()) return;
                    seen = keys;
                    window = typedIn;
                }
                int pid = Front.PidOf(window);
                bool skip = Native.GetForegroundWindow() != window || pid <= 0
                    // Buddy's own windows (the panel) are not where the person writes, and a terminal runs what is
                    // pasted into it.
                    || pid == Program.OwnerPid || pid == OwnPid || Front.IsTerminal(window);
                if (!skip)
                {
                    // Never a password field. When that cannot be told the tag goes on, as captureSelection does: it
                    // asks again before it copies anything.
                    FieldKind field = FocusedField.Read();
                    skip = field.Password || field.Terminal;
                }
                lock (Lock)
                {
                    // A key since the pause began: the next pause decides.
                    if (keys != seen || !watching) return;
                    ClearTyped();
                }
                if (!skip) Program.Send(Program.Obj("event", "tag", "pid", pid));
            }
            catch (Exception e)
            {
                Program.Log("could not act on a tag: " + Program.Describe(e));
            }
        }

        /// Is there a tag in what was typed? Under Lock.
        static bool HasTag()
        {
            if (Typed.Length == 0) return false;
            string text = Typed.ToString();
            foreach (string name in names)
            {
                string tag = "@" + name;
                int at = text.IndexOf(tag, StringComparison.OrdinalIgnoreCase);
                while (at >= 0)
                {
                    int after = at + tag.Length;
                    bool startsWord = at == 0 || (!IsWordCharacter(text[at - 1]) && text[at - 1] != '@');
                    bool endsWord = after >= text.Length || !IsWordCharacter(text[after]);
                    if (startsWord && endsWord) return true;
                    at = text.IndexOf(tag, at + 1, StringComparison.OrdinalIgnoreCase);
                }
            }
            return false;
        }

        /// A letter, a digit or "_", as \p{L}, \p{N} and _ in shared/tag.js.
        static bool IsWordCharacter(char c)
        {
            return char.IsLetter(c) || char.IsNumber(c) || c == '_';
        }

        /// Forget what was typed, and any pause that was counting. Under Lock.
        static void ClearTyped()
        {
            Typed.Length = 0;
            keys++;
            if (pause != null) pause.Change(Timeout.Infinite, Timeout.Infinite);
        }
    }
}
