// Is the field that has the keyboard focus a password field? Asked through UI Automation, which the classic Windows
// apps, the browsers (Chrome, Edge, Firefox) and the newer Windows apps all answer.

using System;
using System.Threading;
using System.Windows.Automation;

namespace BuddyHelper
{
    static class SecureField
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

        /// A hung app must not keep the helper waiting longer than Buddy waits for it (5 s), so this gives up after a
        /// second. When it cannot tell, it says so on stderr and answers false, so the read goes on, as on the Mac:
        /// most apps refuse to copy out of a password field anyway, and refusing here would break Fix in every app
        /// that does not answer.
        public static bool FocusedIsPassword()
        {
            bool answer = false;
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
                return false;
            }
            if (failure != null)
            {
                Program.Log("could not tell which field has the focus (" + Program.Describe(failure) + "); going on");
                return false;
            }
            return answer;
        }

        static bool Ask()
        {
            AutomationElement focused = AutomationElement.FocusedElement;
            if (focused == null) return false;
            object value = focused.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty);
            return value is bool && (bool)value;
        }
    }
}
