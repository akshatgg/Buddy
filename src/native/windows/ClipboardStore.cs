// The clipboard: saved before Buddy copies or pastes and put back after, in every format it held, with Windows' own
// clipboard functions.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace BuddyHelper
{
    /// One format of a saved clipboard: its bytes, or an enhanced metafile (a drawing, as Office puts there).
    sealed class SavedFormat
    {
        public uint Format;
        public byte[] Bytes;
        public IntPtr Metafile;
    }

    static class ClipboardStore
    {
        const uint UnicodeText = 13; // CF_UNICODETEXT
        const uint EnhancedMetafile = 14; // CF_ENHMETAFILE

        // Formats that ask clipboard history (Win+V), the cloud clipboard and clipboard managers to leave the contents
        // out. The two "Can..." ones hold a DWORD, 0 for no; "Exclude..." counts whatever it holds. Password managers
        // put "Exclude..." or "Clipboard Viewer Ignore" on what they copy. The "Can..." ones alone mean only private
        // (Chrome's incognito windows put them on every copy).
        static readonly uint ExcludeFromMonitors = Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
        static readonly uint CanIncludeInHistory = Native.RegisterClipboardFormat("CanIncludeInClipboardHistory");
        static readonly uint CanUploadToCloud = Native.RegisterClipboardFormat("CanUploadToCloudClipboard");
        static readonly uint ViewerIgnore = Native.RegisterClipboardFormat("Clipboard Viewer Ignore");

        // OLE's own bookkeeping, which names the window of the app that copied: put back by Buddy it would point other
        // apps at that app's data instead of the formats restored here.
        static readonly HashSet<string> OlePrivate = new HashSet<string>(StringComparer.Ordinal) { "DataObject", "Ole Private Data" };

        static NativeWindow owner;

        /// The window Buddy's clipboard writes belong to. Windows tells it when another app takes the clipboard, and
        /// waits for the answer, so it is made on the main thread, whose message loop answers at once. On the worker,
        /// which sleeps while it waits for keys to land, it would keep the next app that copies waiting too.
        public static void Start()
        {
            owner = new NativeWindow();
            var parameters = new CreateParams();
            parameters.Parent = new IntPtr(-3); // HWND_MESSAGE: a window that is never shown, only sent messages
            owner.CreateHandle(parameters);
        }

        /// Goes up by one each time anyone changes the clipboard.
        public static uint Sequence()
        {
            return Native.GetClipboardSequenceNumber();
        }

        public static List<SavedFormat> Save()
        {
            var saved = new List<SavedFormat>();
            Open();
            try
            {
                uint format = 0;
                while ((format = Native.EnumClipboardFormats(format)) != 0)
                {
                    if (Skipped(format)) continue;
                    IntPtr data = Native.GetClipboardData(format);
                    if (data == IntPtr.Zero) continue;
                    if (format == EnhancedMetafile)
                    {
                        IntPtr copy = Native.CopyEnhMetaFile(data, null);
                        if (copy != IntPtr.Zero) saved.Add(new SavedFormat { Format = format, Metafile = copy });
                        continue;
                    }
                    byte[] bytes = Read(data);
                    if (bytes != null) saved.Add(new SavedFormat { Format = format, Bytes = bytes });
                }
            }
            finally
            {
                Native.CloseClipboard();
            }
            return saved;
        }

        /// Puts back what Save() read, in the same order, so that an app that takes the first format it knows gets
        /// the same one as before. It is kept out of clipboard history and the cloud clipboard: it was already there
        /// once, and Win+V would otherwise show it again after every use of Buddy.
        public static void Restore(List<SavedFormat> saved)
        {
            Open();
            try
            {
                Native.EmptyClipboard();
                bool historyAnswered = false;
                bool cloudAnswered = false;
                foreach (SavedFormat item in saved)
                {
                    historyAnswered |= item.Format == CanIncludeInHistory;
                    cloudAnswered |= item.Format == CanUploadToCloud;
                    if (item.Metafile == IntPtr.Zero)
                    {
                        Put(item.Format, item.Bytes);
                    }
                    else if (Native.SetClipboardData(item.Format, item.Metafile) != IntPtr.Zero)
                    {
                        item.Metafile = IntPtr.Zero; // the clipboard has it now
                    }
                }
                // An empty clipboard stays empty.
                if (saved.Count > 0 && !historyAnswered) Put(CanIncludeInHistory, BitConverter.GetBytes(0));
                if (saved.Count > 0 && !cloudAnswered) Put(CanUploadToCloud, BitConverter.GetBytes(0));
            }
            finally
            {
                Native.CloseClipboard();
            }
        }

        /// Frees what Save() kept and the clipboard did not take over.
        public static void Release(List<SavedFormat> saved)
        {
            foreach (SavedFormat item in saved)
            {
                if (item.Metafile != IntPtr.Zero) Native.DeleteEnhMetaFile(item.Metafile);
                item.Metafile = IntPtr.Zero;
            }
        }

        /// Buddy's own short-lived write: the text that is about to be pasted, with Windows line breaks (a classic
        /// Windows text box shows a bare \n as nothing), and kept out of history, the cloud and clipboard managers.
        public static void WriteTemporary(string text)
        {
            Open();
            try
            {
                Native.EmptyClipboard();
                Put(UnicodeText, Encoding.Unicode.GetBytes(text.Replace("\r\n", "\n").Replace("\n", "\r\n") + "\0"));
                foreach (uint format in new[] { ExcludeFromMonitors, CanIncludeInHistory, CanUploadToCloud })
                {
                    Put(format, BitConverter.GetBytes(0));
                }
            }
            finally
            {
                Native.CloseClipboard();
            }
        }

        /// Whether what is on the clipboard is marked secret, as password managers mark what they copy. KeePass, for
        /// one, copies the selected entry's password on Ctrl+C, though no password field has the focus.
        public static bool HoldsSecret()
        {
            return Native.IsClipboardFormatAvailable(ExcludeFromMonitors) || Native.IsClipboardFormatAvailable(ViewerIgnore);
        }

        /// The text on the clipboard, or "" when there is none.
        public static string ReadText()
        {
            Open();
            try
            {
                IntPtr data = Native.GetClipboardData(UnicodeText);
                if (data == IntPtr.Zero) return "";
                byte[] bytes = Read(data);
                if (bytes == null) return "";
                string text = Encoding.Unicode.GetString(bytes, 0, bytes.Length - bytes.Length % 2);
                int end = text.IndexOf('\0');
                return end >= 0 ? text.Substring(0, end) : text;
            }
            finally
            {
                Native.CloseClipboard();
            }
        }

        /// Formats that are not plain memory and cannot be copied this way, or that Windows makes again from the ones
        /// saved: a bitmap (made from the DIB), an old-style metafile (made from the enhanced one), a palette, the
        /// "display" and owner-drawn formats, private and drawing-object handles, and OLE's own bookkeeping.
        static bool Skipped(uint format)
        {
            if (format == 2 || format == 3 || format == 9 || format == 0x80 || format == 0x82 || format == 0x83 || format == 0x8E) return true;
            if (format >= 0x0200 && format <= 0x03FF) return true;
            return format >= 0xC000 && OlePrivate.Contains(NameOf(format));
        }

        /// The name an app registered a format under ("HTML Format", "Rich Text Format", ...).
        static string NameOf(uint format)
        {
            var name = new StringBuilder(256);
            return Native.GetClipboardFormatName(format, name, name.Capacity) > 0 ? name.ToString() : "";
        }

        static byte[] Read(IntPtr memory)
        {
            ulong size = Native.GlobalSize(memory).ToUInt64();
            if (size == 0 || size > int.MaxValue) return null;
            IntPtr pointer = Native.GlobalLock(memory);
            if (pointer == IntPtr.Zero) return null;
            try
            {
                var bytes = new byte[size];
                Marshal.Copy(pointer, bytes, 0, (int)size);
                return bytes;
            }
            finally
            {
                Native.GlobalUnlock(memory);
            }
        }

        static void Put(uint format, byte[] bytes)
        {
            IntPtr memory = Native.GlobalAlloc(Native.GMEM_MOVEABLE, new UIntPtr((uint)Math.Max(bytes.Length, 1)));
            if (memory == IntPtr.Zero) return;
            IntPtr pointer = Native.GlobalLock(memory);
            if (pointer == IntPtr.Zero)
            {
                Native.GlobalFree(memory);
                return;
            }
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            Native.GlobalUnlock(memory);
            // Once the clipboard takes the memory it is the clipboard's; until then it is still Buddy's to free.
            if (Native.SetClipboardData(format, memory) == IntPtr.Zero) Native.GlobalFree(memory);
        }

        /// Another app may hold the clipboard open for a moment: keep trying for about half a second.
        static void Open()
        {
            for (int i = 0; i < 30; i++)
            {
                if (Native.OpenClipboard(owner.Handle)) return;
                Thread.Sleep(15);
            }
            throw new HelperError("clipboard_busy", "The clipboard is busy. Try again.");
        }
    }
}
