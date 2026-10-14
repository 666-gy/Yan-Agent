$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class YanExecutableIcon {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHDefExtractIcon(string file, int index, uint flags, out IntPtr large, out IntPtr small, uint size);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr icon);
}
'@
$large = [IntPtr]::Zero
$small = [IntPtr]::Zero
try {
  $result = [YanExecutableIcon]::SHDefExtractIcon($env:YAN_ICON_EXECUTABLE, 0, 0, [ref]$large, [ref]$small, 256)
  if ($result -ne 0 -or $large -eq [IntPtr]::Zero) { throw 'No executable icon' }
  $icon = [System.Drawing.Icon]::FromHandle($large)
  $bitmap = $icon.ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Write([Convert]::ToBase64String($stream.ToArray()))
  } finally { $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose() }
} finally {
  if ($large -ne [IntPtr]::Zero) { [void][YanExecutableIcon]::DestroyIcon($large) }
  if ($small -ne [IntPtr]::Zero) { [void][YanExecutableIcon]::DestroyIcon($small) }
}
