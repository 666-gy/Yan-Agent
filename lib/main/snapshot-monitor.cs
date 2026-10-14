using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class SnapshotGestureDetector {
  readonly HashSet<int> held = new HashSet<int>();
  int tapGroup, activeGroup;
  long tapTime, downTime;
  bool interrupted, fired;
  static int Group(int key) { return key == 164 || key == 165 || key == 18 ? 1 : key == 160 || key == 161 || key == 16 ? 2 : 0; }
  string Gesture(int group) { fired = true; tapGroup = 0; return group == 1 ? "Alt+Alt" : "Shift+Shift"; }
  public string Feed(int key, bool down, long now, bool otherModifier) {
    int group = Group(key);
    if (group == 0) { if (down) { interrupted = true; tapGroup = 0; } return null; }
    if (down && held.Add(key)) {
      if (held.Count == 1) { activeGroup = group; downTime = now; interrupted = otherModifier; fired = false; }
      else if (activeGroup != group) { interrupted = true; tapGroup = 0; }
      if (!interrupted && !fired && ((group == 1 && held.Contains(164) && held.Contains(165)) || (group == 2 && held.Contains(160) && held.Contains(161)))) return Gesture(group);
    } else if (!down && held.Remove(key) && held.Count == 0) {
      if (!interrupted && !fired && now - downTime < 400) {
        if (tapGroup == group && now - tapTime < 400) return Gesture(group);
        tapGroup = group; tapTime = now;
      } else tapGroup = 0;
    }
    return null;
  }
}

// Only window identity and recognized modifier gestures leave this process.
// Ordinary keys are never retained or emitted; they only cancel a gesture.
public static class YanSnapshotMonitor {
  delegate bool EnumProc(IntPtr window, IntPtr data);
  delegate IntPtr KeyProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attr, out int value, int size);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, KeyProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static int owner;
  static IntPtr hook;
  static KeyProc keyCallback = OnKey;
  static readonly List<IntPtr> recent = new List<IntPtr>();
  static readonly SnapshotGestureDetector gestureDetector = new SnapshotGestureDetector();
  static string pendingGesture;
  static readonly Stopwatch clock = Stopwatch.StartNew();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static string lastTarget = "";
  static int ticks;
  // The expensive step in Describe is MainModule.FileVersionInfo: a cross-process
  // read of the executable's version resource. Windows recycles PIDs slowly, so
  // caching the resolved name per PID for the life of a wake cycle turns hundreds
  // of lookups per scan into one per distinct process.
  static readonly Dictionary<int, string> nameCache = new Dictionary<int, string>();
  static readonly int currentPid = Process.GetCurrentProcess().Id;
  static System.Windows.Forms.Timer timer;
  // Posts from the key hook and from the stdin reader are marshalled through
  // this control so they land on the thread that owns the message pump.
  static Control marshaler;
  static volatile bool awake;
  // Idle polling only has to remember which window was last in front; once the
  // attachment surface is open the list has to track the desktop closely.
  const int IdleInterval = 2000, ActiveInterval = 400;
  static void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
  static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
    if (code >= 0) {
      int msg = message.ToInt32();
      bool down = msg == 256 || msg == 260, up = msg == 257 || msg == 261;
      if (down || up) {
        int key = Marshal.ReadInt32(data);
        bool blocked = GetAsyncKeyState(17) < 0 || GetAsyncKeyState(91) < 0 || GetAsyncKeyState(92) < 0;
        string gesture = gestureDetector.Feed(key, down, clock.ElapsedMilliseconds, blocked);
        if (gesture != null) {
          pendingGesture = gesture;
          // Writing to a pipe from inside the hook would hold it pending, and a
          // stalled low-level hook freezes keyboard input for every process on
          // the machine. Hand the work to the message pump instead.
          Post(DrainGesture);
        }
      }
    }
    return CallNextHookEx(hook, code, message, data);
  }
  static Dictionary<string, object> Describe(IntPtr window) {
    if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return null;
    uint pid; GetWindowThreadProcessId(window, out pid);
    if (pid == owner || pid == currentPid) return null;
    var title = new StringBuilder(1024); GetWindowText(window, title, title.Capacity);
    if (title.Length == 0) return null;
    var cls = new StringBuilder(128); GetClassName(window, cls, cls.Capacity);
    if (cls.ToString() == "Shell_TrayWnd" || cls.ToString() == "Shell_SecondaryTrayWnd" || cls.ToString() == "Progman" || cls.ToString() == "WorkerW") return null;
    if ((GetWindowLong(window, -20) & 0x80) != 0) return null;
    int cloaked; if (DwmGetWindowAttribute(window, 14, out cloaked, 4) == 0 && cloaked != 0) return null;
    string processName = "", name = title.ToString();
    int pidInt = (int)pid;
    string cachedName;
    if (nameCache.TryGetValue(pidInt, out cachedName)) {
      name = cachedName;
    } else {
      try {
        using (var process = Process.GetProcessById(pidInt)) {
          processName = process.ProcessName;
          if (processName.Equals("Yan Agent", StringComparison.OrdinalIgnoreCase) || name.Equals("Yan Agent", StringComparison.OrdinalIgnoreCase) || name.StartsWith("Yan Agent —")) return null;
          try { var info = process.MainModule.FileVersionInfo; if (!String.IsNullOrWhiteSpace(info.FileDescription)) name = info.FileDescription; } catch {}
        }
        if (processName.Equals("QQ", StringComparison.OrdinalIgnoreCase) || processName.Equals("QQNT", StringComparison.OrdinalIgnoreCase)) name = "QQ";
        else if (processName.Equals("msedge", StringComparison.OrdinalIgnoreCase)) name = "Microsoft Edge";
        else if (processName.Equals("chrome", StringComparison.OrdinalIgnoreCase)) name = "Google Chrome";
        else if (processName.Equals("explorer", StringComparison.OrdinalIgnoreCase)) name = "资源管理器";
        else if (processName.Equals("electron", StringComparison.OrdinalIgnoreCase)) name = title.ToString();
        if (nameCache.Count < 64) nameCache[pidInt] = name;
      } catch { return null; }
    }
    return new Dictionary<string, object> { {"handle", window.ToInt64().ToString()}, {"pid", pid}, {"name", name}, {"title", title.ToString()} };
  }
  static void Scan(bool force) {
    var foreground = GetForegroundWindow();
    if (Describe(foreground) != null) { recent.Remove(foreground); recent.Insert(0, foreground); }
    var candidates = new List<Dictionary<string, object>>();
    for (int i = 0; i < recent.Count;) {
      var item = Describe(recent[i]);
      if (item == null) recent.RemoveAt(i); else { candidates.Add(item); i++; }
    }
    // The OS z-order seeds history at launch and provides a fallback after closing.
    EnumWindows((window, unused) => {
      if (candidates.Count >= 16) return false;
      if (!recent.Contains(window)) { var item = Describe(window); if (item != null) candidates.Add(item); }
      return true;
    }, IntPtr.Zero);
    if (recent.Count > 32) recent.RemoveRange(32, recent.Count - 32);
    string value = json.Serialize(candidates);
    if (force || value != lastTarget || ++ticks >= 8) { ticks = 0; lastTarget = value; Emit(new { type = "targets", items = candidates }); }
  }
  static void DrainGesture() {
    if (pendingGesture == null) return;
    // A gesture fires while dormant: the capture handler needs fresh targets.
    // Force a scan so the main process has the current desktop state before
    // the gesture event tells it to capture.
    if (!awake) Scan(true);
    var gesture = pendingGesture; pendingGesture = null;
    Emit(new { type = "gesture", shortcut = gesture });
  }

  // BeginInvoke posts to the pump, but throws before the control has a handle.
  // Before that point nothing has started the pump yet, so running inline is
  // already on the right thread.
  static void Post(Action work) {
    try { marshaler.BeginInvoke(work); return; } catch {}
    try { work(); } catch {}
  }

  public static void Run(int ownerPid) {
    owner = ownerPid;
    marshaler = new Control(); marshaler.CreateControl();
    hook = SetWindowsHookEx(13, keyCallback, GetModuleHandle(null), 0);
    Emit(new { type = "ready", keyboard = hook != IntPtr.Zero });
    var pump = new System.Windows.Forms.Timer(); pump.Interval = IdleInterval;
    timer = pump;

    // The stdin reader runs on a background thread and marshals state changes
    // back to the UI thread that owns the timer. PowerShell -File mode forwards
    // stdin to Console.In, so the parent can send wake/sleep/quit without kill.
    var stdinReader = new Thread(() => {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          line = line.Trim();
          if (line == "wake") Post(() => {
            if (awake) return;
            awake = true; pump.Interval = ActiveInterval;
            Scan(true);  // Emit targets now so capture has fresh data
          });
          else if (line == "sleep") Post(() => {
            if (!awake) return;
            awake = false; pump.Interval = IdleInterval;
            // Cheaper to re-resolve after a lull than to hold names for PIDs
            // Windows may since have recycled.
            nameCache.Clear();
          });
          else if (line == "quit") { Post(Application.ExitThread); return; }
        }
      } catch {}
      Post(Application.ExitThread);  // EOF or a broken pipe: the parent is gone
    }) { IsBackground = true };
    stdinReader.Start();

    pump.Tick += (sender, args) => {
      try { using (var parent = Process.GetProcessById(owner)) { if (parent.HasExited) { Application.ExitThread(); return; } } }
      catch { Application.ExitThread(); return; }
      Scan(false);
      DrainGesture();
    };

    try { pump.Start(); Application.Run(); }
    finally { pump.Dispose(); if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); marshaler.Dispose(); }
  }
}
