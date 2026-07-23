using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;

namespace YanComputerUseCursorHost
{
    internal static class Program
    {
        private const uint SpiSetCursors = 0x0057;

        private static readonly uint[] SystemCursorIds =
        {
            32512, // OCR_NORMAL
            32513, // OCR_IBEAM
            32514, // OCR_WAIT
            32515, // OCR_CROSS
            32516, // OCR_UP
            32640, // OCR_SIZE
            32641, // OCR_ICON
            32642, // OCR_SIZENWSE
            32643, // OCR_SIZENESW
            32644, // OCR_SIZEWE
            32645, // OCR_SIZENS
            32646, // OCR_SIZEALL
            32648, // OCR_NO
            32649, // OCR_HAND
            32650, // OCR_APPSTARTING
            32651, // OCR_HELP
            32671, // OCR_PIN
            32672  // OCR_PERSON
        };

        private static readonly object CursorLock = new object();
        private static volatile bool shouldExit;

        [StructLayout(LayoutKind.Sequential)]
        private struct IconInfo
        {
            [MarshalAs(UnmanagedType.Bool)]
            public bool fIcon;
            public uint xHotspot;
            public uint yHotspot;
            public IntPtr hbmMask;
            public IntPtr hbmColor;
        }

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetSystemCursor(IntPtr cursor, uint cursorId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SystemParametersInfo(
            uint action,
            uint parameter,
            IntPtr value,
            uint flags
        );

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr CreateIconIndirect(ref IconInfo iconInfo);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DestroyCursor(IntPtr cursor);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr CreateBitmap(
            int width,
            int height,
            uint planes,
            uint bitsPerPixel,
            IntPtr bits
        );

        [DllImport("gdi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeleteObject(IntPtr handle);

        private static int Main(string[] args)
        {
            if (args.Length != 2 || args[0] != "--host")
            {
                Console.Error.WriteLine("Usage: YanComputerUseCursorHost.exe --host <parent-pid>");
                return 2;
            }

            int parentPid;
            if (!int.TryParse(args[1], out parentPid) || parentPid <= 0)
            {
                Console.Error.WriteLine("Invalid parent process id.");
                return 2;
            }

            Process parentProcess;
            try
            {
                parentProcess = Process.GetProcessById(parentPid);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Unable to watch parent process: " + error.Message);
                return 3;
            }

            // A prior abnormal termination may have left a temporary cursor active.
            RestoreSystemCursors();

            var inputThread = new Thread(ReadCommands)
            {
                IsBackground = true,
                Name = "YanComputerUseCursorCommands"
            };
            inputThread.Start();
            Console.Out.WriteLine("READY");
            Console.Out.Flush();

            try
            {
                while (!shouldExit)
                {
                    if (parentProcess.HasExited) break;
                    Thread.Sleep(200);
                }
            }
            catch
            {
                // Losing the parent handle is treated the same as the app exiting.
            }
            finally
            {
                RestoreSystemCursors();
                parentProcess.Dispose();
            }

            return 0;
        }

        private static void ReadCommands()
        {
            try
            {
                string line;
                while (!shouldExit && (line = Console.In.ReadLine()) != null)
                {
                    var command = line.Trim().ToUpperInvariant();
                    if (command == "APPLY")
                    {
                        try
                        {
                            ApplyYanCursor();
                            WriteStatus("APPLIED");
                        }
                        catch (Exception error)
                        {
                            WriteStatus("ERROR " + error.Message);
                        }
                    }
                    else if (command == "RESTORE")
                    {
                        RestoreSystemCursors();
                        WriteStatus("RESTORED");
                    }
                    else if (command == "EXIT")
                    {
                        shouldExit = true;
                        break;
                    }
                }
            }
            finally
            {
                shouldExit = true;
            }
        }

        private static void WriteStatus(string status)
        {
            Console.Out.WriteLine(status);
            Console.Out.Flush();
        }

        private static void ApplyYanCursor()
        {
            lock (CursorLock)
            {
                var failures = new List<uint>();
                foreach (var cursorId in SystemCursorIds)
                {
                    var cursor = CreateYanCursor();
                    if (cursor == IntPtr.Zero || !SetSystemCursor(cursor, cursorId))
                    {
                        if (cursor != IntPtr.Zero) DestroyCursor(cursor);
                        failures.Add(cursorId);
                    }
                    // SetSystemCursor owns and destroys a successfully assigned handle.
                }

                if (failures.Count == SystemCursorIds.Length)
                {
                    throw new InvalidOperationException("Windows rejected every custom cursor role.");
                }
            }
        }

        private static void RestoreSystemCursors()
        {
            lock (CursorLock)
            {
                SystemParametersInfo(SpiSetCursors, 0, IntPtr.Zero, 0);
            }
        }

        private static IntPtr CreateYanCursor()
        {
            const int size = 48;
            using (var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(bitmap))
            using (var pointerPath = CreatePointerPath())
            {
                graphics.Clear(Color.Transparent);
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.CompositingMode = CompositingMode.SourceOver;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

                using (var shadowMatrix = new Matrix())
                using (var shadowPath = (GraphicsPath)pointerPath.Clone())
                using (var shadowBrush = new SolidBrush(Color.FromArgb(64, 16, 94, 205)))
                {
                    shadowMatrix.Translate(1.5f, 2.0f);
                    shadowPath.Transform(shadowMatrix);
                    graphics.FillPath(shadowBrush, shadowPath);
                }

                using (var pointerBrush = new LinearGradientBrush(
                    new PointF(6, 4),
                    new PointF(30, 42),
                    Color.FromArgb(255, 112, 218, 255),
                    Color.FromArgb(255, 24, 113, 239)))
                using (var outerOutline = new Pen(Color.FromArgb(248, 255, 255, 255), 4.2f))
                using (var blueOutline = new Pen(Color.FromArgb(255, 18, 99, 211), 1.7f))
                {
                    outerOutline.LineJoin = LineJoin.Round;
                    blueOutline.LineJoin = LineJoin.Round;
                    graphics.FillPath(pointerBrush, pointerPath);
                    graphics.DrawPath(outerOutline, pointerPath);
                    graphics.DrawPath(blueOutline, pointerPath);
                }

                var colorBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
                var maskBitmap = CreateBitmap(size, size, 1, 1, IntPtr.Zero);
                if (colorBitmap == IntPtr.Zero || maskBitmap == IntPtr.Zero)
                {
                    if (colorBitmap != IntPtr.Zero) DeleteObject(colorBitmap);
                    if (maskBitmap != IntPtr.Zero) DeleteObject(maskBitmap);
                    return IntPtr.Zero;
                }

                var iconInfo = new IconInfo
                {
                    fIcon = false,
                    xHotspot = 6,
                    yHotspot = 5,
                    hbmColor = colorBitmap,
                    hbmMask = maskBitmap
                };

                var cursor = CreateIconIndirect(ref iconInfo);
                DeleteObject(colorBitmap);
                DeleteObject(maskBitmap);
                return cursor;
            }
        }

        private static GraphicsPath CreatePointerPath()
        {
            var path = new GraphicsPath();
            path.AddPolygon(new[]
            {
                new PointF(6.0f, 4.0f),
                new PointF(8.5f, 36.6f),
                new PointF(19.3f, 25.7f),
                new PointF(34.6f, 23.8f)
            });
            path.CloseFigure();
            return path;
        }
    }
}
