using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
class ShellJob {
  [StructLayout(LayoutKind.Sequential)] struct SI { public int cb; public IntPtr reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,reserved2; public IntPtr reserved3,stdin,stdout,stderr; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SA security,uint creation,uint flags,IntPtr template);
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long perProcess,perJob; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,ref Accounting info,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  static int Main(string[] args) {
    IntPtr job=IntPtr.Zero, input=IntPtr.Zero; PI pi=new PI();
    try {
      if(args.Length==2 && args[0]=="--process-start") {
        try { Console.Write(System.Diagnostics.Process.GetProcessById(int.Parse(args[1])).StartTime.ToUniversalTime().Ticks); return 0; }
        catch(ArgumentException) { return 3; }
      }
      if(args.Length==2 && args[0]=="--job-active") {
        job=OpenJobObject(4,false,args[1]);
        if(job==IntPtr.Zero) { if(Marshal.GetLastWin32Error()==2) return 0; return 2; }
        var accounting=new Accounting();
        if(!QueryInformationJobObject(job,1,ref accounting,(uint)Marshal.SizeOf(accounting),IntPtr.Zero)) return 2;
        return accounting.active==0 ? 0 : 1;
      }
      if(args.Length<2 || args.Length>3) throw new Exception("Expected executable, encoded command line and optional ownership name");
      job=CreateJobObject(IntPtr.Zero,args.Length==3 ? args[2] : null);
      var limits=new Extended(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE
      if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) throw new System.ComponentModel.Win32Exception();
      var sa=new SA(); sa.length=Marshal.SizeOf(sa); sa.inherit=1;
      input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);
      if(input==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
      var si=new SI(); si.cb=Marshal.SizeOf(si); si.flags=0x100; si.stdin=input; si.stdout=GetStdHandle(-11); si.stderr=GetStdHandle(-12);
      var cmd=new StringBuilder(Encoding.UTF8.GetString(Convert.FromBase64String(args[1])));
      if(!CreateProcess(args[0],cmd,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref si,out pi)) throw new System.ComponentModel.Win32Exception();
      if(!AssignProcessToJobObject(job,pi.process)) { TerminateProcess(pi.process,1); throw new System.ComponentModel.Win32Exception(); }
      var ownedJob=job;
      var watcher=new Thread(()=>{ try { while(Console.OpenStandardInput().ReadByte()!=-1) {} TerminateJobObject(ownedJob,1); } catch {} });
      watcher.IsBackground=true; watcher.Start();
      ResumeThread(pi.thread); WaitForSingleObject(pi.process,0xffffffff);
      uint code; GetExitCodeProcess(pi.process,out code); return unchecked((int)code);
    } catch(Exception e) { Console.Error.WriteLine("Yan shell supervision: "+e.Message); return 1; }
    finally { if(job!=IntPtr.Zero)CloseHandle(job); if(input!=IntPtr.Zero && input!=new IntPtr(-1))CloseHandle(input); if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero)CloseHandle(pi.process); }
  }
}
