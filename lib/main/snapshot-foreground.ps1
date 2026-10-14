Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YanSnapshotWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
[Console]::WriteLine([YanSnapshotWindow]::GetForegroundWindow().ToInt64().ToString())
