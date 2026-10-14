using System;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Security.Cryptography;

class WindowIconProbe {
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid format; public uint id; public PropertyKey(uint value) { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); id = value; } }
  [StructLayout(LayoutKind.Explicit, Size=24)] struct Variant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text; }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Store {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out Variant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref Variant value);
    [PreserveSig] int Commit();
  }
  [DllImport("shell32")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Store store);
  [DllImport("ole32")] static extern int PropVariantClear(ref Variant value);
  [DllImport("user32")] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  delegate bool EnumWindowProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32")] static extern bool EnumWindows(EnumWindowProc callback, IntPtr param);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32", EntryPoint="GetClassLongPtrW")] static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
  [DllImport("user32")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32")] static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int width, int height, uint step, IntPtr brush, uint flags);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
  [DllImport("user32")] static extern bool DestroyIcon(IntPtr icon);
  [StructLayout(LayoutKind.Sequential)] struct ImageSize {public int width,height;}
  [ComImport,Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ImageFactory {
    [PreserveSig] int GetImage(ImageSize size,uint flags,out IntPtr bitmap);
  }
  [DllImport("shell32",CharSet=CharSet.Unicode,PreserveSig=false)] static extern void SHCreateItemFromParsingName(string name,IntPtr context,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out ImageFactory factory);
  [DllImport("gdi32")] static extern bool DeleteObject(IntPtr obj);
  static object ProbeShell(string appId,string directory,bool file) {
    var iid=typeof(ImageFactory).GUID;ImageFactory factory;
    SHCreateItemFromParsingName(file?appId:"shell:AppsFolder\\"+appId,IntPtr.Zero,ref iid,out factory);
    try {IntPtr bitmap;Marshal.ThrowExceptionForHR(factory.GetImage(new ImageSize{width=48,height=48},4,out bitmap));
      try {using(var image=Image.FromHbitmap(bitmap))image.Save(Path.Combine(directory,file?"reference.png":"shell.png"),ImageFormat.Png);}
      finally {DeleteObject(bitmap);}
      return new {appId,shellIcon=Path.Combine(directory,file?"reference.png":"shell.png")};
    }finally {Marshal.ReleaseComObject(factory);}
  }
  static string Fingerprint(IntPtr icon, string file) {
    if (icon == IntPtr.Zero) return "";
    using (var bitmap = new Bitmap(48,48,PixelFormat.Format32bppArgb)) {
      using(var graphics=Graphics.FromImage(bitmap)) {
        graphics.Clear(Color.FromArgb(32,32,32)); var dc=graphics.GetHdc();
        try { if(!DrawIconEx(dc,0,0,icon,48,48,0,IntPtr.Zero,3)) throw new Exception("DrawIconEx failed"); }
        finally { graphics.ReleaseHdc(dc); }
      }
      if(!String.IsNullOrEmpty(file)) bitmap.Save(file,ImageFormat.Png);
      var pixels=bitmap.LockBits(new Rectangle(0,0,48,48),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      try { var bytes=new byte[Math.Abs(pixels.Stride)*48]; Marshal.Copy(pixels.Scan0,bytes,0,bytes.Length); using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
      finally {bitmap.UnlockBits(pixels);}
    }
  }
  static object Probe(IntPtr hwnd, string directory, string expected) {
    var iid=typeof(Store).GUID; Store store; Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd,ref iid,out store));
    try {
      var title=new StringBuilder(512); GetWindowText(hwnd,title,512); var cls=new StringBuilder(256); GetClassName(hwnd,cls,256);
      var big=SendMessage(hwnd,0x7f,new IntPtr(1),IntPtr.Zero); var small=SendMessage(hwnd,0x7f,IntPtr.Zero,IntPtr.Zero);
      var handles=new Dictionary<string,IntPtr>{{"big",big},{"small",small},{"small2",SendMessage(hwnd,0x7f,new IntPtr(2),IntPtr.Zero)},{"classBig",GetClassLongPtr(hwnd,-14)},{"classSmall",GetClassLongPtr(hwnd,-34)}};
      var fingerprints=new Dictionary<string,string>();
      foreach(var entry in handles) fingerprints[entry.Key]=Fingerprint(entry.Value,String.IsNullOrEmpty(directory)?null:Path.Combine(directory,hwnd+"-"+entry.Key+".png"));
      var expectedPrints=new Dictionary<string,string>();
      if(!String.IsNullOrEmpty(expected)) foreach(int size in new[]{16,20,24,32,40,48,64,256}) {
        var icon=LoadImage(IntPtr.Zero,expected,1,size,size,0x10); try {expectedPrints[size.ToString()]=Fingerprint(icon,String.IsNullOrEmpty(directory)?null:Path.Combine(directory,"expected-"+size+".png"));} finally {if(icon!=IntPtr.Zero)DestroyIcon(icon);}
      }
      return new {hwnd=hwnd.ToInt64(),title=title.ToString(),className=cls.ToString(),visible=IsWindowVisible(hwnd),owner=GetWindow(hwnd,4).ToInt64(),appId=Read(store,5),iconResource=Read(store,3),relaunchCommand=Read(store,2),displayName=Read(store,4),bigIcon=big.ToInt64(),smallIcon=small.ToInt64(),fingerprints,expectedPrints};
    } finally {Marshal.ReleaseComObject(store);}
  }
  static string Read(Store store, uint id) { var key = new PropertyKey(id); Variant value; Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value)); try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : ""; } finally { PropVariantClear(ref value); } }
  static int Main(string[] args) {
    try {
      string directory=args.Length>1?args[1]:null; if(!String.IsNullOrEmpty(directory))Directory.CreateDirectory(directory);
      string expected=args.Length>2?args[2]:null; object result;
      if(args[0].StartsWith("shell:")) result=ProbeShell(args[0].Substring(6),directory,false);
      else if(args[0].StartsWith("image:")) result=ProbeShell(args[0].Substring(6),directory,true);
      else if(args[0].StartsWith("pid:")) { uint target=UInt32.Parse(args[0].Substring(4)); var windows=new List<object>(); EnumWindows((hwnd,param)=>{uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid==target)windows.Add(Probe(hwnd,directory,expected));return true;},IntPtr.Zero); result=windows; }
      else result=Probe(new IntPtr(Int64.Parse(args[0])),directory,expected);
      Console.WriteLine(new JavaScriptSerializer().Serialize(result));
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
  }
}
