// A picture of one app window, as Check screen sends it to the AI.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

namespace BuddyHelper
{
    static class WindowCapture
    {
        const int LongEdge = 1568;
        const long JpegQuality = 80;

        /// The window as a JPEG, in base64. The app draws it itself, so whatever is on top of it (Buddy's panel among
        /// others) is not in the picture. Cropped to what shows of the window; the long edge is at most 1568 pixels.
        public static string Jpeg(IntPtr window)
        {
            Native.RECT outer;
            if (!Native.GetWindowRect(window, out outer)) throw new HelperError("no_window", "No window to capture.");
            int width = outer.Right - outer.Left;
            int height = outer.Bottom - outer.Top;
            if (width <= 0 || height <= 0) throw new HelperError("no_window", "No window to capture.");

            // 32 bits with no alpha: GDI leaves the alpha byte at zero, which would read as see-through.
            using (var whole = new Bitmap(width, height, PixelFormat.Format32bppRgb))
            {
                using (Graphics canvas = Graphics.FromImage(whole))
                {
                    IntPtr dc = canvas.GetHdc();
                    bool drawn;
                    try
                    {
                        drawn = Native.PrintWindow(window, dc, Native.PW_RENDERFULLCONTENT);
                    }
                    finally
                    {
                        canvas.ReleaseHdc(dc);
                    }
                    if (!drawn) throw new HelperError("capture_failed", "Could not take the screenshot. Try again.");
                }

                Rectangle visible = Visible(window, outer);
                double scale = Math.Min(1.0, (double)LongEdge / Math.Max(visible.Width, visible.Height));
                int w = Math.Max(1, (int)Math.Round(visible.Width * scale));
                int h = Math.Max(1, (int)Math.Round(visible.Height * scale));
                using (var small = new Bitmap(w, h, PixelFormat.Format24bppRgb))
                {
                    using (Graphics canvas = Graphics.FromImage(small))
                    {
                        canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        canvas.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        canvas.DrawImage(whole, new Rectangle(0, 0, w, h), visible, GraphicsUnit.Pixel);
                    }
                    return Encode(small);
                }
            }
        }

        /// What shows of the window, within its picture. Windows 10 and 11 put invisible borders around a window, for
        /// resizing it, and the picture has them as black edges.
        static Rectangle Visible(IntPtr window, Native.RECT outer)
        {
            var whole = new Rectangle(0, 0, outer.Right - outer.Left, outer.Bottom - outer.Top);
            Native.RECT frame;
            int size = Marshal.SizeOf(typeof(Native.RECT));
            if (Native.DwmGetWindowAttribute(window, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out frame, size) != 0) return whole;
            var bounds = new Rectangle(frame.Left - outer.Left, frame.Top - outer.Top, frame.Right - frame.Left, frame.Bottom - frame.Top);
            Rectangle shown = Rectangle.Intersect(whole, bounds);
            return shown.Width > 0 && shown.Height > 0 ? shown : whole;
        }

        static string Encode(Bitmap picture)
        {
            ImageCodecInfo jpeg = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
            using (var parameters = new EncoderParameters(1))
            using (var stream = new MemoryStream())
            {
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, JpegQuality);
                picture.Save(stream, jpeg, parameters);
                return Convert.ToBase64String(stream.ToArray());
            }
        }
    }
}
