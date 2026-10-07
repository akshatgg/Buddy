// BuddyHelper for Windows: the Windows side of Buddy, started once by the Electron main process
// (src/main/helper.js), as src/native/BuddyHelper.swift is on the Mac. It speaks the same protocol, one JSON
// object per line on stdin and stdout:
//
//   request  {"id": 1, "cmd": "paste", "args": {...}}
//   reply    {"id": 1, "ok": true, "result": {...}}
//            {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//   event    {"event": "frontApp", "pid": 123, "bundleId": "chrome.exe", "name": "Google Chrome"}
//
// Commands run one at a time on a worker thread, and lines go out through a writer thread. The main thread only
// runs the message loop: it receives the events that say which app is in front, and it owns the window that
// Buddy's clipboard writes belong to, so both are answered at once even while a command waits or a large reply
// (a screenshot) is being written. When stdin closes (Buddy quit) the helper exits.
//
// Written in C# 5 for .NET Framework 4.8, so that the C# compiler that comes with Windows builds it
// (tools/build-native.js): no string interpolation, no ?. and no => members. ASCII only, as that compiler reads
// a file in the PC's own code page.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BuddyHelper
{
    /// A failure the person is told about: Code is what Buddy branches on, and the message is shown as it is.
    sealed class HelperError : Exception
    {
        public readonly string Code;

        public HelperError(string code, string message) : base(message)
        {
            Code = code;
        }
    }

    static class Program
    {
        /// Buddy's main process, which owns all of Buddy's windows (0 when it was not given).
        public static int OwnerPid;

        static readonly object SerializeLock = new object();
        static readonly JavaScriptSerializer Writer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static readonly BlockingCollection<Dictionary<string, object>> Work = new BlockingCollection<Dictionary<string, object>>();
        static readonly BlockingCollection<byte[]> Lines = new BlockingCollection<byte[]>();

        [STAThread]
        static void Main(string[] args)
        {
            // Before anything makes a window: sizes and pictures in real pixels, and a failure in the message loop
            // logged, never shown in a dialog.
            Native.BecomeDpiAware();
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                Log("the message loop failed: " + Describe(e.Exception));
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Log("stopped: " + Describe(e.ExceptionObject as Exception));
            };
            OwnerPid = OwnerPidFrom(args);

            Background(WriteLines);
            ClipboardStore.Start();
            Front.Start();
            FocusedField.Warm();
            Background(ReadRequests);
            Background(DoWork);
            Application.Run();
        }

        static int OwnerPidFrom(string[] args)
        {
            int i = Array.IndexOf(args, "--owner-pid");
            int pid;
            if (i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out pid)) return pid;
            return 0;
        }

        static void Background(ThreadStart run)
        {
            var thread = new Thread(run);
            thread.IsBackground = true;
            thread.Start();
        }

        static void ReadRequests()
        {
            var reader = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            string line;
            while ((line = input.ReadLine()) != null)
            {
                Dictionary<string, object> request = null;
                try
                {
                    request = reader.DeserializeObject(line) as Dictionary<string, object>;
                }
                catch (Exception)
                {
                    // A line that is not JSON is skipped, as on the Mac.
                }
                if (request != null) Work.Add(request);
            }
            Environment.Exit(0);
        }

        static void DoWork()
        {
            foreach (Dictionary<string, object> request in Work.GetConsumingEnumerable()) Handle(request);
        }

        /// A broken pipe is not an error to .NET's console streams: when Buddy is gone, stdin closes and the helper
        /// exits (ReadRequests).
        static void WriteLines()
        {
            Stream stdout = Console.OpenStandardOutput();
            foreach (byte[] line in Lines.GetConsumingEnumerable())
            {
                stdout.Write(line, 0, line.Length);
                stdout.Flush();
            }
        }

        static void Handle(Dictionary<string, object> request)
        {
            object id = Get(request, "id");
            string cmd = Get(request, "cmd") as string ?? "";
            var args = Get(request, "args") as Dictionary<string, object> ?? new Dictionary<string, object>();
            try
            {
                Dictionary<string, object> result;
                switch (cmd)
                {
                    case "ping":
                        result = Obj("pong", true);
                        break;
                    case "frontmost":
                        result = Front.Frontmost();
                        break;
                    // Windows asks for neither: any program may send keys and draw another's window.
                    case "permissions":
                        result = Obj("accessibility", true, "screenRecording", true);
                        break;
                    case "requestAccessibility":
                    case "requestScreenRecording":
                        result = Obj("granted", true);
                        break;
                    case "captureSelection":
                        result = Commands.CaptureSelection(args);
                        break;
                    case "paste":
                        result = Commands.Paste(args);
                        break;
                    case "press":
                        result = Commands.Press(args);
                        break;
                    case "windowTitle":
                        result = Commands.WindowTitle(args);
                        break;
                    case "screenshot":
                        result = Commands.Screenshot(args);
                        break;
                    case "activate":
                        result = Commands.Activate(args);
                        break;
                    case "focusWindow":
                        result = Commands.FocusWindow(args);
                        break;
                    default:
                        throw new HelperError("bad_request", "unknown command");
                }
                Send(Obj("id", id, "ok", true, "result", result));
            }
            catch (HelperError e)
            {
                Send(Obj("id", id, "ok", false, "error", Obj("code", e.Code, "message", e.Message)));
            }
            catch (Exception e)
            {
                // Windows' own wording is for the log; the person gets plain words.
                Log((cmd == "" ? "a command" : cmd) + " failed: " + Describe(e));
                Send(Obj("id", id, "ok", false, "error", Obj("code", "failed", "message", "Something went wrong. Try again.")));
            }
        }

        /// The value under `key`, or null.
        public static object Get(Dictionary<string, object> map, string key)
        {
            object value;
            return map.TryGetValue(key, out value) ? value : null;
        }

        /// {"a": 1, "b": 2} from Obj("a", 1, "b", 2).
        public static Dictionary<string, object> Obj(params object[] pairs)
        {
            var map = new Dictionary<string, object>();
            for (int i = 0; i + 1 < pairs.Length; i += 2) map[(string)pairs[i]] = pairs[i + 1];
            return map;
        }

        /// One JSON line for stdout, from any thread, in the order they are sent: the writer thread writes it, so
        /// nobody here waits for Buddy to read it.
        public static void Send(Dictionary<string, object> message)
        {
            lock (SerializeLock)
            {
                Lines.Add(Encoding.UTF8.GetBytes(Writer.Serialize(message) + "\n"));
            }
        }

        /// One line on stderr, which Buddy's main process passes on to its own log. It holds codes, numbers and the
        /// system's own error descriptions, never any text that came from an app or from the person.
        public static void Log(string text)
        {
            try
            {
                Console.Error.WriteLine("[buddy-helper] " + text);
            }
            catch (Exception)
            {
                // Nowhere to say it.
            }
        }

        public static string Describe(Exception e)
        {
            return e == null ? "an unknown error" : e.GetType().Name + ": " + e.Message;
        }
    }
}
