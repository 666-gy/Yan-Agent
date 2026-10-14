param([int]$ParentPid)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
public static class YanControlCursor {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT point; public uint privateData; }
    delegate IntPtr MouseHook(int code, IntPtr message, IntPtr data);
    static MouseHook callback = OnMouse;
    static IntPtr hook;
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int kind, MouseHook proc, IntPtr module, uint thread);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
        int kind = message.ToInt32();
        if (code >= 0 && (kind == 0x201 || kind == 0x204 || kind == 0x207)) {
            var point = (POINT)Marshal.PtrToStructure(data, typeof(POINT));
            Emit(point, "click");
        }
        return CallNextHookEx(hook, code, message, data);
    }
    static void Emit(POINT point, string kind) {
        Console.WriteLine("{\"type\":\"" + kind + "\",\"x\":" + point.x + ",\"y\":" + point.y + "}");
    }
    public static void StartFeedback() {
        hook = SetWindowsHookEx(14, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) throw new Exception("Cannot observe control pointer");
    }
    public static void PumpFeedback() {
        MSG message;
        while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {}
        POINT point; if (GetCursorPos(out point)) Emit(point, "move");
    }
    public static void StopFeedback() { if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
    public static System.Threading.Tasks.Task<string> WaitForExit() {
        return System.Threading.Tasks.Task.Run(() => Console.ReadLine());
    }
    [StructLayout(LayoutKind.Sequential)] struct ICONINFO {
        public bool icon; public uint x, y; public IntPtr mask, color;
    }
    [DllImport("user32.dll")] static extern IntPtr CreateIconIndirect(ref ICONINFO info);
    [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr cursor, uint id);
    [DllImport("user32.dll")] static extern bool DestroyCursor(IntPtr cursor);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint flags);
    public static void Restore() { SystemParametersInfo(0x57, 0, IntPtr.Zero, 0); }
    public static void Apply() {
        // Same filled Keyline arrow as the approved 48 x 48 preview; hotspot at its tip.
        using (var bitmap = new Bitmap(48, 48))
        using (var mask = new Bitmap(48, 48))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var shape = new GraphicsPath())
        using (var brush = new SolidBrush(Color.FromArgb(47, 169, 229))) {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            shape.AddPolygon(new PointF[] { new PointF(18.54f,19.78f), new PointF(26.02f,43.3f),
                new PointF(27.88f,43.42f), new PointF(32.82f,32.88f), new PointF(43.38f,28.22f),
                new PointF(43.32f,26.36f), new PointF(19.8f,18.52f) });
            graphics.FillPath(brush, shape);
            IntPtr color = bitmap.GetHbitmap(Color.FromArgb(0)), mono = mask.GetHbitmap();
            try {
                foreach (uint id in new uint[] { 32512,32513,32514,32515,32516,32642,32643,32644,32645,32646,32648,32649,32650,32651 }) {
                    var info = new ICONINFO { icon = false, x = 19, y = 19, mask = mono, color = color };
                    IntPtr cursor = CreateIconIndirect(ref info);
                    if (cursor == IntPtr.Zero) throw new Exception("Cannot create control cursor");
                    if (!SetSystemCursor(cursor, id)) { DestroyCursor(cursor); throw new Exception("Cannot set control cursor"); }
                }
            } finally { DeleteObject(color); DeleteObject(mono); }
        }
    }
}
'@
try {
    $owner = [System.Diagnostics.Process]::GetProcessById($ParentPid)
    $inputClosed = [YanControlCursor]::WaitForExit()
    if (!$owner.HasExited -and !$inputClosed.IsCompleted) {
        [YanControlCursor]::Apply()
        [YanControlCursor]::StartFeedback()
        [Console]::WriteLine('ready')
        while (!$inputClosed.IsCompleted -and !$owner.HasExited) {
            [YanControlCursor]::PumpFeedback()
            Start-Sleep -Milliseconds 16
        }
    }
} finally {
    # EOF, normal exit, and a crashed host all restore the user's configured cursor scheme.
    [YanControlCursor]::StopFeedback()
    [YanControlCursor]::Restore()
}
