// What the field that has the keyboard focus is, asked through UI Automation, which the classic Windows apps, the
// browsers (Chrome, Edge, Firefox), the newer Windows apps and the Electron apps all answer.

using System;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace BuddyHelper
{
    /// A password field, or the input of a terminal that lives inside an app (VS Code's and other xterm.js ones, where
    /// Ctrl+C with nothing selected stops the running program, as in any terminal).
    sealed class FieldKind
    {
        public bool Password;
        public bool Terminal;
    }

    static class FocusedField
    {
        /// UI Automation takes a moment to start the first time: it is started at launch, so that the first real
        /// question does not spend its second on that.
        public static void Warm()
        {
            var thread = new Thread(delegate()
            {
                try
                {
                    Ask();
                }
                catch (Exception)
                {
                    // Only a warm-up.
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        /// When it cannot tell, it says so on stderr and answers "neither", so the read goes on, as on the Mac: most
        /// apps refuse to copy out of a password field anyway, and refusing here would break Fix in every app that
        /// does not answer.
        public static FieldKind Read()
        {
            FieldKind answer = null;
            if (!WithinASecond(delegate() { answer = Ask(); }, "could not tell which field has the focus")) return new FieldKind();
            return answer;
        }

        /// True only when the focused element is surely not a place to type: a web page or a mail being read, plain
        /// text, a link or a picture that was clicked. Then a paste would do nothing, and Buddy would say "Done!" for
        /// nothing: the text goes to the clipboard instead (src/main/actions.js). As on the Mac (focusedIsReadOnly in
        /// src/native/BuddyHelper.swift), anything Buddy cannot tell about counts as a place to type, so that a paste is
        /// never refused by mistake.
        public static bool ReadOnly()
        {
            bool answer = false;
            if (!WithinASecond(delegate() { answer = AskReadOnly(); }, "could not tell whether the focused field takes text")) return false;
            return answer;
        }

        /// Runs `ask` on a thread of its own. A hung app must not keep the helper waiting longer than Buddy waits for
        /// it, so this gives up after a second. False when it gave up or `ask` failed, which `what` then says on stderr.
        static bool WithinASecond(ThreadStart ask, string what)
        {
            Exception failure = null;
            var thread = new Thread(delegate()
            {
                try
                {
                    ask();
                }
                catch (Exception e)
                {
                    failure = e;
                }
            });
            thread.IsBackground = true;
            thread.Start();
            if (!thread.Join(1000))
            {
                Program.Log(what + " (no answer within a second); going on");
                return false;
            }
            if (failure != null)
            {
                Program.Log(what + " (" + Program.Describe(failure) + "); going on");
                return false;
            }
            return true;
        }

        static FieldKind Ask()
        {
            var kind = new FieldKind();
            AutomationElement focused = AutomationElement.FocusedElement;
            if (focused == null) return kind;
            object password = focused.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty);
            kind.Password = password is bool && (bool)password;
            // In web pages and Electron apps the class name is the HTML element's class.
            string className = focused.GetCurrentPropertyValue(AutomationElement.ClassNameProperty) as string;
            kind.Terminal = className != null && className.Contains("xterm-helper-textarea");
            return kind;
        }

        static bool AskReadOnly()
        {
            AutomationElement focused = AutomationElement.FocusedElement;
            if (focused == null) return false;
            // Only a document, plain text, a link or a picture, as on the Mac. Anything else may take text: a box, a
            // list, or a pane, which is all UI Automation sees of an editor that draws its own text (Sublime Text, say).
            ControlType type = focused.GetCurrentPropertyValue(AutomationElement.ControlTypeProperty) as ControlType;
            bool document = type == ControlType.Document;
            if (!document && type != ControlType.Text && type != ControlType.Hyperlink && type != ControlType.Image) return false;
            // Its value says whether it can be changed (a page that is a box as a whole can), when it has one.
            object valueReadOnly = focused.GetCurrentPropertyValue(ValuePattern.IsReadOnlyProperty, true);
            if (valueReadOnly is bool) return (bool)valueReadOnly;
            if (!document) return true; // plain text, a link or a picture, with no value to set
            // A document with no value, as Word's and Chrome's are: its text says whether it is read-only, where the
            // person's selection (or the caret) is, else all of it. A mix, or no answer, counts as a place to type.
            object pattern;
            if (!focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return false;
            var text = (TextPattern)pattern;
            TextPatternRange[] ranges;
            try
            {
                ranges = text.GetSelection();
            }
            catch (InvalidOperationException)
            {
                ranges = new TextPatternRange[0]; // a document whose text cannot be selected
            }
            if (ranges.Length == 0) ranges = new[] { text.DocumentRange };
            foreach (TextPatternRange range in ranges)
            {
                object readOnly = range.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                if (!(readOnly is bool) || !(bool)readOnly) return false;
            }
            return true;
        }
    }
}
