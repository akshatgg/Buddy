// What the field that has the keyboard focus is, asked through UI Automation, which the classic Windows apps, the
// browsers (Chrome, Edge, Firefox), the newer Windows apps and the Electron apps all answer.

using System;
using System.Threading;
using System.Windows.Automation;

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

        /// A hung app must not keep the helper waiting longer than Buddy waits for it, so this gives up after a second.
        /// When it cannot tell, it says so on stderr and answers "neither", so the read goes on, as on the Mac: most
        /// apps refuse to copy out of a password field anyway, and refusing here would break Fix in every app that
        /// does not answer.
        public static FieldKind Read()
        {
            FieldKind answer = null;
            Exception failure = null;
            var thread = new Thread(delegate()
            {
                try
                {
                    answer = Ask();
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
                Program.Log("could not tell which field has the focus (no answer within a second); going on");
                return new FieldKind();
            }
            if (failure != null)
            {
                Program.Log("could not tell which field has the focus (" + Program.Describe(failure) + "); going on");
                return new FieldKind();
            }
            return answer;
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
    }
}
