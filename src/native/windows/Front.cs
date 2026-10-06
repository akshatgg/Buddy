// Which app the person is in: the window in front, as Windows reports it changing, and bringing an app's window
// back to the front before keys are sent to it.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace BuddyHelper
{
    static class Front
    {
        // Windows' own shell, never the app the person is writing in: the taskbar and its overflow, the desktop,
        // Start, search and the notification centre, and the task switchers.
        static readonly HashSet<string> ShellClasses = new HashSet<string>(StringComparer.Ordinal)
        {
            "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
            "Progman", "WorkerW", "#32769", "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow",
            "MultitaskingViewFrame", "TaskSwitcherWnd", "ForegroundStaging",
        };

        // Terminals (Windows Terminal, the console, Git Bash, ConEmu, PuTTY): Ctrl+C there stops the running program
        // when nothing is selected, and every line pasted into one runs.
        static readonly HashSet<string> TerminalClasses = new HashSet<string>(StringComparer.Ordinal)
        {
            "CASCADIA_HOSTING_WINDOW_CLASS", "ConsoleWindowClass", "mintty", "VirtualConsoleClass", "PuTTY",
        };

        static readonly object Lock = new object();
        static readonly Dictionary<int, IntPtr> LastWindow = new Dictionary<int, IntPtr>(); // per process: its last window in front
        static readonly Dictionary<string, string> Names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); // per program file
        static readonly int OwnPid = Process.GetCurrentProcess().Id;
        static Native.WinEventProc onForeground; // kept here, so that the garbage collector leaves the hook's callback alone

        /// On the main thread, whose message loop delivers the events.
        public static void Start()
        {
            onForeground = OnForeground;
            Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, onForeground,
                0, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS);
            Note(Native.GetForegroundWindow());
        }

        static void OnForeground(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint thread, uint time)
        {
            try
            {
                Note(window);
            }
            catch (Exception e)
            {
                Program.Log("could not tell which app is in front: " + Program.Describe(e));
            }
        }

        static void Note(IntPtr window)
        {
            int pid = PidOf(window);
            // Buddy itself is never the app the person is writing in, and neither is Windows' shell.
            if (pid <= 0 || pid == Program.OwnerPid || pid == OwnPid || ShellClasses.Contains(ClassOf(window))) return;
            lock (Lock) LastWindow[pid] = window;
            Dictionary<string, object> e = AppInfo(pid, window);
            e["event"] = "frontApp";
            Program.Send(e);
        }

        /// pid, bundleId (the program's file name, like chrome.exe) and name (its own description, like Google Chrome).
        public static Dictionary<string, object> AppInfo(int pid, IntPtr window)
        {
            string file = ProgramFile(pid);
            string name = NameOf(file);
            // Store apps run inside "Application Frame Host": the window's title is their name.
            if (string.Equals(Path.GetFileName(file), "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                name = TitleOf(window);
            }
            return Program.Obj("pid", pid, "bundleId", Path.GetFileName(file), "name", name);
        }

        public static Dictionary<string, object> Frontmost()
        {
            IntPtr window = Native.GetForegroundWindow();
            int pid = PidOf(window);
            return pid > 0 ? AppInfo(pid, window) : new Dictionary<string, object>();
        }

        public static bool IsTerminal(IntPtr window)
        {
            return TerminalClasses.Contains(ClassOf(window));
        }

        /// The window of `pid` to bring back or to capture: the last of its windows that was in front, while it is
        /// still there, or else its first window on the screen.
        public static IntPtr WindowFor(int pid)
        {
            IntPtr window;
            lock (Lock) LastWindow.TryGetValue(pid, out window);
            if (window != IntPtr.Zero && Native.IsWindow(window) && PidOf(window) == pid) return window;
            IntPtr found = IntPtr.Zero;
            Native.EnumWindows(delegate(IntPtr candidate, IntPtr unused)
            {
                bool own = PidOf(candidate) == pid && Native.IsWindowVisible(candidate);
                if (!own || Native.GetWindow(candidate, Native.GW_OWNER) != IntPtr.Zero) return true;
                found = candidate;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        /// Bring `pid` to the front. Returns how it got there, or null when it could not.
        public static string EnsureFront(int pid)
        {
            // The panel that Buddy has just hidden hands the focus back to the app below it, the person's, by itself.
            if (WaitFront(pid, 250)) return "already";
            IntPtr window = WindowFor(pid);
            if (window == IntPtr.Zero) return null;
            if (Native.IsIconic(window)) Native.ShowWindow(window, Native.SW_RESTORE);
            // Windows lets a program bring a window to the front only in a few cases, one of them being that it sent
            // the last input event. An input event that does nothing is enough.
            KeyInput.Nothing();
            Native.SetForegroundWindow(window);
            if (WaitFront(pid, 400)) return "activate";
            // Second try: share the input of the thread in front, which also lets a window be brought forward.
            uint unused;
            uint front = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out unused);
            uint mine = Native.GetCurrentThreadId();
            bool joined = front != 0 && front != mine && Native.AttachThreadInput(mine, front, true);
            try
            {
                Native.BringWindowToTop(window);
                Native.SetForegroundWindow(window);
            }
            finally
            {
                if (joined) Native.AttachThreadInput(mine, front, false);
            }
            return WaitFront(pid, 400) ? "attach" : null;
        }

        /// Does `pid` run as administrator while Buddy does not? Windows then drops the keys Buddy sends it, without
        /// a word. When that cannot be told, the answer is yes: the answer is copied, rather than lost.
        public static bool RunsAboveUs(int pid)
        {
            if (Elevated(OwnPid) == true) return false;
            return Elevated(pid) != false;
        }

        static bool WaitFront(int pid, int milliseconds)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (true)
            {
                if (PidOf(Native.GetForegroundWindow()) == pid) return true;
                if (DateTime.UtcNow >= until) return false;
                Thread.Sleep(20);
            }
        }

        static bool? Elevated(int pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
            if (process == IntPtr.Zero) return null;
            try
            {
                IntPtr token;
                if (!Native.OpenProcessToken(process, Native.TOKEN_QUERY, out token)) return null;
                try
                {
                    uint elevated;
                    uint size;
                    if (!Native.GetTokenInformation(token, Native.TokenElevation, out elevated, 4, out size)) return null;
                    return elevated != 0;
                }
                finally
                {
                    Native.CloseHandle(token);
                }
            }
            finally
            {
                Native.CloseHandle(process);
            }
        }

        public static int PidOf(IntPtr window)
        {
            if (window == IntPtr.Zero) return 0;
            uint pid;
            Native.GetWindowThreadProcessId(window, out pid);
            return (int)pid;
        }

        static string ClassOf(IntPtr window)
        {
            var name = new StringBuilder(256);
            return Native.GetClassName(window, name, name.Capacity) > 0 ? name.ToString() : "";
        }

        static string TitleOf(IntPtr window)
        {
            var title = new StringBuilder(512);
            return Native.GetWindowText(window, title, title.Capacity) > 0 ? title.ToString().Trim() : "";
        }

        /// The full path of the program `pid` runs, or "".
        static string ProgramFile(int pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
            if (process == IntPtr.Zero) return "";
            try
            {
                var path = new StringBuilder(1024);
                uint size = (uint)path.Capacity;
                return Native.QueryFullProcessImageName(process, 0, path, ref size) ? path.ToString() : "";
            }
            finally
            {
                Native.CloseHandle(process);
            }
        }

        /// The name a program gives itself (Google Chrome, WhatsApp), else its file name without .exe.
        static string NameOf(string file)
        {
            if (file == "") return "";
            lock (Lock)
            {
                string known;
                if (Names.TryGetValue(file, out known)) return known;
            }
            string name = "";
            try
            {
                name = (FileVersionInfo.GetVersionInfo(file).FileDescription ?? "").Trim();
            }
            catch (Exception)
            {
                // No version information to read: the file name below will do.
            }
            if (name == "") name = Path.GetFileNameWithoutExtension(file);
            lock (Lock) Names[file] = name;
            return name;
        }
    }
}
