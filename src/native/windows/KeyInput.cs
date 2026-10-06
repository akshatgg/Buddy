// Keys sent to the app in front, as if the person pressed them.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace BuddyHelper
{
    static class KeyInput
    {
        // Virtual-key codes. Windows maps the letters to the keyboard layout, so Ctrl+C is copy on any layout.
        public const ushort A = 0x41;
        public const ushort C = 0x43;
        public const ushort V = 0x56;
        public const ushort Right = 0x27;

        const ushort LeftControl = 0xA2;
        // What the person may still be holding from Buddy's shortcut: the left and right Shift, Ctrl and Alt, and the
        // two Windows keys.
        static readonly ushort[] Modifiers = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };
        // Keys that need the "extended" flag: the right Ctrl and Alt, the Windows keys and the arrows.
        static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0xA3, 0xA5, 0x5B, 0x5C, 0x25, 0x26, 0x27, 0x28 };

        /// Ctrl and `key` together, like Ctrl+C. Buddy's shortcut fires while its keys are still down, and Ctrl+C with
        /// Shift held is Ctrl+Shift+C (the inspector in Chrome). So this waits up to a second for them to be let go,
        /// and lets go of any still down once its own Ctrl is down, so that a lone Alt or Windows key opens no menu.
        public static void PressCtrl(ushort key)
        {
            WaitForModifiersUp(1000);
            var inputs = new List<Native.INPUT>();
            inputs.Add(Key(LeftControl, false));
            foreach (ushort modifier in Modifiers)
            {
                if (modifier != LeftControl && IsDown(modifier)) inputs.Add(Key(modifier, true));
            }
            inputs.Add(Key(key, false));
            inputs.Add(Key(key, true));
            inputs.Add(Key(LeftControl, true));
            Send(inputs);
        }

        /// One key on its own.
        public static void Press(ushort key)
        {
            Send(new List<Native.INPUT> { Key(key, false), Key(key, true) });
        }

        /// An input event that changes nothing: a mouse event with no movement and no button.
        public static void Nothing()
        {
            var input = new Native.INPUT();
            input.type = Native.INPUT_MOUSE;
            Send(new List<Native.INPUT> { input });
        }

        static Native.INPUT Key(ushort vk, bool up)
        {
            var input = new Native.INPUT();
            input.type = Native.INPUT_KEYBOARD;
            input.u.ki.wVk = vk;
            input.u.ki.wScan = (ushort)Native.MapVirtualKey(vk, Native.MAPVK_VK_TO_VSC);
            input.u.ki.dwFlags = (up ? Native.KEYEVENTF_KEYUP : 0) | (Extended.Contains(vk) ? Native.KEYEVENTF_EXTENDEDKEY : 0);
            return input;
        }

        static bool IsDown(ushort vk)
        {
            return (Native.GetAsyncKeyState(vk) & 0x8000) != 0;
        }

        static void WaitForModifiersUp(int milliseconds)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (DateTime.UtcNow < until)
            {
                bool held = false;
                foreach (ushort modifier in Modifiers)
                {
                    if (IsDown(modifier)) held = true;
                }
                if (!held) return;
                Thread.Sleep(15);
            }
        }

        static void Send(List<Native.INPUT> inputs)
        {
            Native.INPUT[] all = inputs.ToArray();
            uint sent = Native.SendInput((uint)all.Length, all, Marshal.SizeOf(typeof(Native.INPUT)));
            if (sent != all.Length)
            {
                Program.Log("Windows took " + sent + " of " + all.Length + " input events (error " + Marshal.GetLastWin32Error() + ")");
            }
        }
    }
}
