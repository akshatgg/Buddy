// Which app the person is in: the window in front, as Windows reports it changing, and bringing a window back to the
// front before keys are sent to it.

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

        // Terminals: Ctrl+C there stops the running program when nothing is selected, and every line pasted into one
        // runs. Known by their window (Windows Terminal, the console, Git Bash, ConEmu, PuTTY) or by their program.
        // Terminals inside other apps (VS Code's) are told by the focused field instead (FocusedField).
        static readonly HashSet<string> TerminalClasses = new HashSet<string>(StringComparer.Ordinal)
        {
            "CASCADIA_HOSTING_WINDOW_CLASS", "ConsoleWindowClass", "mintty", "VirtualConsoleClass", "PuTTY",
        };
        static readonly HashSet<string> TerminalPrograms = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "WindowsTerminal.exe", "OpenConsole.exe", "conhost.exe", "mintty.exe", "ConEmu.exe", "ConEmu64.exe",
            "putty.exe", "kitty.exe", "alacritty.exe", "wezterm-gui.exe", "Tabby.exe", "Hyper.exe", "MobaXterm.exe",
            "powershell_ise.exe",
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
            IntPtr hook = Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero,
                onForeground, 0, 0, Native.WINEVENT_OUTOFCONTEXT | Native.WINEVENT_SKIPOWNPROCESS);
            if (hook == IntPtr.Zero) Program.Log("could not listen for the app in front; Buddy will only know the first one");
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
            return TerminalClasses.Contains(ClassOf(window)) || TerminalPrograms.Contains(Path.GetFileName(ProgramFile(PidOf(window))));
        }

        /// The window of `pid` to bring back or to capture: the last of its windows that was in front, while it is
        /// still there, or else its first ordinary window on the screen.
        public static IntPtr WindowFor(int pid)
        {
            IntPtr window;
            lock (Lock) LastWindow.TryGetValue(pid, out window);
            if (window != IntPtr.Zero && Native.IsWindow(window) && PidOf(window) == pid) return window;
            IntPtr found = IntPtr.Zero;
            Native.EnumWindows(delegate(IntPtr candidate, IntPtr unused)
            {
                if (PidOf(candidate) != pid || !IsOrdinary(candidate)) return true;
                found = candidate;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        /// A window the person can be typing in: shown, not owned by another, not a tool window, not on another
        /// virtual desktop (cloaked), and not part of the shell (explorer.exe runs the taskbar as well as folders).
        static bool IsOrdinary(IntPtr window)
        {
            if (!Native.IsWindowVisible(window) || Native.GetWindow(window, Native.GW_OWNER) != IntPtr.Zero) return false;
            if ((Native.GetWindowLong(window, Native.GWL_EXSTYLE) & Native.WS_EX_TOOLWINDOW) != 0) return false;
            int cloaked;
            if (Native.DwmGetWindowAttribute(window, Native.DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return false;
            return !ShellClasses.Contains(ClassOf(window));
        }

        /// Bring `pid` to the front. Returns how it got there, or null when it could not.
        public static string EnsureFront(int pid)
        {
            Func<bool> arrived = delegate { return PidOf(Native.GetForegroundWindow()) == pid; };
            // Already there, as when the person opened Buddy from it. A panel that Buddy hides keeps the front on
            // Windows (it is hidden without activating another window), so there is little point waiting for more.
            if (Wait(arrived, 50)) return "already";
            IntPtr window = WindowFor(pid);
            return window == IntPtr.Zero ? null : BringForward(window, arrived);
        }

        /// Bring one of Buddy's own windows (the panel) to the front, when Windows did not let Buddy do it.
        public static string FocusOwnWindow(IntPtr window)
        {
            if (!Native.IsWindow(window) || PidOf(window) != Program.OwnerPid) throw new HelperError("bad_request", "not a window of Buddy's");
            // Closed meanwhile: a hidden window must not be given the keyboard.
            if (!Native.IsWindowVisible(window)) return "hidden";
            Func<bool> arrived = delegate { return Native.GetForegroundWindow() == window; };
            if (arrived()) return "already";
            return BringForward(window, arrived);
        }

        /// Does `pid` run as administrator while Buddy does not? Windows then drops the keys Buddy sends it, without
        /// a word. When that cannot be told, the answer is yes: the answer is copied, rather than lost.
        public static bool RunsAboveUs(int pid)
        {
            if (Elevated(OwnPid) == true) return false;
            return Elevated(pid) != false;
        }

        /// SetForegroundWindow, which Windows allows the program that sent the last input event: so one is sent
        /// first, an input event that does nothing. Then, if needed, the same while sharing the input of the thread in
        /// front. Nothing here waits on another app's window, so an app that hangs cannot hang the helper.
        static string BringForward(IntPtr window, Func<bool> arrived)
        {
            if (Native.IsIconic(window)) Native.ShowWindowAsync(window, Native.SW_RESTORE);
            KeyInput.Nothing();
            Native.SetForegroundWindow(window);
            if (Wait(arrived, 400)) return "activate";

            IntPtr front = Native.GetForegroundWindow();
            // Never with a thread that hangs: sharing its input would hang this one too.
            if (front == IntPtr.Zero || Native.IsHungAppWindow(front)) return null;
            uint unused;
            uint frontThread = Native.GetWindowThreadProcessId(front, out unused);
            uint mine = Native.GetCurrentThreadId();
            bool joined = frontThread != 0 && frontThread != mine && Native.AttachThreadInput(mine, frontThread, true);
            try
            {
                Native.SetWindowPos(window, Native.HWND_TOP, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_ASYNCWINDOWPOS);
                Native.SetForegroundWindow(window);
            }
            finally
            {
                if (joined) Native.AttachThreadInput(mine, frontThread, false);
            }
            return Wait(arrived, 400) ? "attach" : null;
        }

        static bool Wait(Func<bool> arrived, int milliseconds)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (true)
            {
                if (arrived()) return true;
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
            if (pid <= 0) return "";
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
