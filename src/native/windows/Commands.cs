// The commands that touch the person's app: read their selection, paste an answer, take a screenshot. They follow
// captureSelection, paste and screenshot in src/native/BuddyHelper.swift, with Ctrl where the Mac has Command.

using System;
using System.Collections.Generic;
using System.Threading;

namespace BuddyHelper
{
    static class Commands
    {
        static int PidArg(Dictionary<string, object> args)
        {
            object pid = Program.Get(args, "pid");
            if (pid is int && (int)pid > 0) return (int)pid;
            throw new HelperError("bad_request", "pid is required");
        }

        static bool Flag(Dictionary<string, object> args, string name)
        {
            object value = Program.Get(args, name);
            return value is bool && (bool)value;
        }

        public static Dictionary<string, object> CaptureSelection(Dictionary<string, object> args)
        {
            int pid = PidArg(args);
            bool selectAll = Flag(args, "selectAll");
            try
            {
                if (Front.EnsureFront(pid) == null) throw new HelperError("not_frontmost", "Could not switch back to that app.");
                // In a terminal Ctrl+C stops the running program when nothing is selected, so it is never sent there:
                // the panel opens with nothing read.
                if (Front.IsTerminal(Native.GetForegroundWindow()))
                {
                    if (selectAll) throw new HelperError("terminal", "I can't read a terminal. Copy your text and paste it here.");
                    return Program.Obj("text", "");
                }
                if (SecureField.FocusedIsPassword()) throw new HelperError("secure_field", "I don't read password fields.");

                // The count comes first, before anything is saved or copied: if it has moved by the end, something put
                // new contents on the clipboard (the copy, or anyone else).
                uint before = ClipboardStore.Sequence();
                List<SavedFormat> saved = ClipboardStore.Save();
                try
                {
                    if (selectAll)
                    {
                        KeyInput.PressCtrl(KeyInput.A);
                        Thread.Sleep(80);
                    }
                    KeyInput.PressCtrl(KeyInput.C);
                    return Program.Obj("text", CopiedText(before));
                }
                finally
                {
                    // "Use the whole box" left everything selected in the person's app. Collapse the selection, so that
                    // the first key they type does not replace their whole draft. Replace selects everything again.
                    if (selectAll) KeyInput.Press(KeyInput.Right);
                    // Put the person's clipboard back only if it changed. A copy that copied nothing leaves it as it
                    // was, and writing it again would add an entry to the clipboard history for nothing.
                    if (ClipboardStore.Sequence() != before) PutBack(saved);
                    ClipboardStore.Release(saved);
                }
            }
            finally
            {
                // The keys above make this helper the program that sent the last input, which Windows lets bring a
                // window to the front. Buddy's panel opens next: let Buddy do that.
                if (Program.OwnerPid > 0) Native.AllowSetForegroundWindow((uint)Program.OwnerPid);
            }
        }

        public static Dictionary<string, object> Paste(Dictionary<string, object> args)
        {
            int pid = PidArg(args);
            string text = Program.Get(args, "text") as string;
            if (text == null) throw new HelperError("bad_request", "text is required");
            string via = Front.EnsureFront(pid);
            if (via == null) throw new HelperError("not_frontmost", "Could not switch back to that app.");
            // Where a paste would go wrong the answer goes to the clipboard instead (src/main/actions.js), which is what
            // a paste that fails does: a terminal runs every line it is given, Windows drops the keys sent to an app
            // that runs as administrator without a word, and Buddy never types into a password field (and "Replace
            // all" would wipe what is in it).
            if (Front.IsTerminal(Native.GetForegroundWindow())) throw new HelperError("terminal", "I don't type into terminals.");
            if (Front.RunsAboveUs(pid)) throw new HelperError("elevated", "That app runs as administrator, so I can't type into it.");
            if (SecureField.FocusedIsPassword()) throw new HelperError("secure_field", "I don't type into password fields.");

            List<SavedFormat> saved = ClipboardStore.Save();
            try
            {
                ClipboardStore.WriteTemporary(text);
                if (Flag(args, "selectAll"))
                {
                    KeyInput.PressCtrl(KeyInput.A);
                    Thread.Sleep(80);
                }
                KeyInput.PressCtrl(KeyInput.V);
                // The app reads the clipboard after it handles Ctrl+V; putting it back too early would paste the
                // person's old clipboard instead.
                Thread.Sleep(500);
            }
            finally
            {
                // Always put it back: Buddy's own write above changed the clipboard.
                PutBack(saved);
                ClipboardStore.Release(saved);
            }
            return Program.Obj("via", via);
        }

        public static Dictionary<string, object> Screenshot(Dictionary<string, object> args)
        {
            int pid = PidArg(args);
            IntPtr window = Front.WindowFor(pid);
            // As on the Mac, only a window that is on the screen: a minimised one has nothing to show.
            if (window == IntPtr.Zero || !Native.IsWindowVisible(window) || Native.IsIconic(window))
            {
                throw new HelperError("no_window", "No window to capture.");
            }
            try
            {
                return Program.Obj("image", WindowCapture.Jpeg(window));
            }
            catch (HelperError)
            {
                throw;
            }
            catch (Exception e)
            {
                // Windows' own wording is for the log; the person gets plain words.
                Program.Log("the screenshot failed: " + Program.Describe(e));
                throw new HelperError("capture_failed", "Could not take the screenshot. Try again.");
            }
        }

        /// The text the copy put on the clipboard, waiting up to 300 ms for it; "" when the clipboard did not change.
        static string CopiedText(uint before)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(300);
            while (DateTime.UtcNow < until)
            {
                if (ClipboardStore.Sequence() != before) return ClipboardStore.ReadText();
                Thread.Sleep(15);
            }
            return "";
        }

        /// Puts the person's clipboard back. A failure is only logged: whatever the command does next is still right.
        static void PutBack(List<SavedFormat> saved)
        {
            try
            {
                ClipboardStore.Restore(saved);
            }
            catch (Exception e)
            {
                Program.Log("could not put the clipboard back: " + Program.Describe(e));
            }
        }
    }
}
