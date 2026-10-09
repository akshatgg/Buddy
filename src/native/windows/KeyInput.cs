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
        public const ushort D = 0x44;
        public const ushort V = 0x56;
        public const ushort Z = 0x5A;
        public const ushort Return = 0x0D;
        public const ushort Right = 0x27;
        public const ushort Up = 0x26;

        public const ushort LeftShift = 0xA0;
        public const ushort LeftControl = 0xA2;
        public const ushort LeftAlt = 0xA4;
        // Keys that need the "extended" flag: the right Ctrl and Alt, the Windows keys and the arrows.
        static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0xA3, 0xA5, 0x5B, 0x5C, 0x25, 0x26, 0x27, 0x28 };

        /// Ctrl and `key` together, like Ctrl+C, once the person has let go of every key. Buddy's shortcut fires while
        /// its keys are still down: Ctrl+C with Shift held would be Ctrl+Shift+C (the inspector in Chrome). Keys still
        /// held after 3 seconds are never let go of on the person's behalf: the keyboard would go on repeating the last
        /// one (the shortcut's Space) with nothing held with it, typing spaces over their text. Nothing is sent then.
        public static void PressCtrl(ushort key)
        {
            PressWith(key, new ushort[] { LeftControl });
        }

        /// `key` with the modifier keys `modifiers` held, like Ctrl+Enter, once the person has let go of every key, as
        /// PressCtrl says. The modifiers go down in their order and come up the other way round.
        public static void PressWith(ushort key, ushort[] modifiers)
        {
            if (!WaitForKeysUp(3000)) throw new HelperError("keys_held", "Let go of the keys, then try again.");
            IntPtr layout = ForegroundLayout();
            var inputs = new List<Native.INPUT>();
            foreach (ushort modifier in modifiers) inputs.Add(Key(modifier, false, layout));
            inputs.Add(Key(key, false, layout));
            inputs.Add(Key(key, true, layout));
            for (int i = modifiers.Length - 1; i >= 0; i--) inputs.Add(Key(modifiers[i], true, layout));
            Send(inputs);
        }

        /// One key on its own.
        public static void Press(ushort key)
        {
            IntPtr layout = ForegroundLayout();
            Send(new List<Native.INPUT> { Key(key, false, layout), Key(key, true, layout) });
        }

        /// An input event that changes nothing: a mouse event with no movement and no button. Windows lets the program
        /// that sent the last input event bring a window to the front (and hand that on to Buddy).
        public static void Nothing()
        {
            var input = new Native.INPUT();
            input.type = Native.INPUT_MOUSE;
            Send(new List<Native.INPUT> { input });
        }

        /// True once no key is down (the mouse buttons aside), false when some still are after `milliseconds`.
        public static bool WaitForKeysUp(int milliseconds)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(milliseconds);
            while (true)
            {
                if (!AnyKeyDown()) return true;
                if (DateTime.UtcNow >= until) return false;
                Thread.Sleep(15);
            }
        }

        static bool AnyKeyDown()
        {
            // 0x01 to 0x07 are the mouse buttons (and Ctrl+Break); 0xFF is no key.
            for (int vk = 0x08; vk <= 0xFE; vk++)
            {
                if (!IsInputMethodKey(vk) && (Native.GetAsyncKeyState(vk) & 0x8000) != 0) return true;
            }
            return false;
        }

        /// The keys of input methods (Japanese, Korean, Chinese and the like), which can read as down for as long as
        /// their mode is on: 0x15 to 0x1F (Esc, 0x1B, aside), 0xE5, 0xE7 and 0xF0 to 0xF6.
        public static bool IsInputMethodKey(int vk)
        {
            return (vk >= 0x15 && vk <= 0x1F && vk != 0x1B) || vk == 0xE5 || vk == 0xE7 || (vk >= 0xF0 && vk <= 0xF6);
        }

        /// The keyboard layout of the app in front, which the keys are for: the scan codes follow it (they matter to
        /// Remote Desktop and virtual machines, which pass scan codes on).
        static IntPtr ForegroundLayout()
        {
            uint unused;
            uint thread = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out unused);
            return Native.GetKeyboardLayout(thread);
        }

        static Native.INPUT Key(ushort vk, bool up, IntPtr layout)
        {
            var input = new Native.INPUT();
            input.type = Native.INPUT_KEYBOARD;
            input.u.ki.wVk = vk;
            input.u.ki.wScan = (ushort)Native.MapVirtualKeyEx(vk, Native.MAPVK_VK_TO_VSC, layout);
            input.u.ki.dwFlags = (up ? Native.KEYEVENTF_KEYUP : 0) | (Extended.Contains(vk) ? Native.KEYEVENTF_EXTENDEDKEY : 0);
            return input;
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
