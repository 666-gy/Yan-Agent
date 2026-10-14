using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

[assembly: AssemblyTitle("Yan Agent 安装")]
[assembly: AssemblyProduct("Yan Agent")]
[assembly: AssemblyVersion("1.7.0.0")]
[assembly: AssemblyFileVersion("1.7.0.1")]

internal sealed class SetupUI {
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern uint GetPrivateProfileString(string section, string key, string fallback, StringBuilder value, uint size, string file);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool WritePrivateProfileString(string section, string key, string value, string file);
  [DllImport("shell32", CharSet = CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
  readonly string ini;
  readonly bool preview;
  Window window;
  DispatcherTimer timer;
  bool installing, finished, sampling;
  int lastProgress;
  string selectedDirectory;
  T Find<T>(string name) where T : class { return window.FindName(name) as T; }
  string Read(string key, string fallback) { var b = new StringBuilder(4096); GetPrivateProfileString("Setup", key, fallback, b, 4096, ini); return b.ToString(); }
  void Write(string key, string value) { if (!WritePrivateProfileString("Setup", key, value, ini)) throw new IOException("无法写入安装状态。"); }
  SetupUI(string stateFile, bool isPreview) { ini = Path.GetFullPath(stateFile); preview = isPreview; }

  [STAThread] static int Main(string[] args) {
    try {
      if (args.Length < 1) return 2;
      SetCurrentProcessExplicitAppUserModelID("com.yan.agent.setup");
      var ui = new SetupUI(args[0], args.Length > 1 && args[1] == "--preview");
      ui.Run(); return 0;
    } catch (Exception error) { MessageBox.Show("安装界面无法启动：" + error.Message, "Yan Agent", MessageBoxButton.OK, MessageBoxImage.Error); return 1; }
  }

  void Run() {
    var assembly = Assembly.GetExecutingAssembly();
    using (var stream = assembly.GetManifestResourceStream("SetupWindow.xaml")) window = (Window)XamlReader.Load(stream);
    var logo = new BitmapImage();
    using (var stream = assembly.GetManifestResourceStream("logo.png")) { logo.BeginInit(); logo.CacheOption = BitmapCacheOption.OnLoad; logo.StreamSource = stream; logo.EndInit(); logo.Freeze(); }
    Find<Image>("Logo").Source = logo;
    window.Icon = logo;
    Find<TextBlock>("Version").Text = "v" + Read("Version", "1.7.0-beta.1-rc").Replace("-beta.", " Beta").Replace("-rc", "-RC");
    Find<TextBox>("InstallDirectory").Text = Read("InstallDir", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Yan Agent"));
    Find<CheckBox>("AddToPath").IsChecked = Read("AddToPath", "1") == "1";
    Find<Grid>("TitleArea").MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) { if (e.OriginalSource is Button) return; try { window.DragMove(); } catch (InvalidOperationException) {} };
    Find<Button>("Minimize").Click += delegate { window.WindowState = WindowState.Minimized; };
    Find<Button>("Close").Click += delegate { window.Close(); };
    Find<Button>("Browse").Click += delegate {
      using (var dialog = new System.Windows.Forms.FolderBrowserDialog()) {
        dialog.Description = "选择 Yan Agent 安装位置";
        dialog.SelectedPath = Find<TextBox>("InstallDirectory").Text;
        var owner = new System.Windows.Forms.NativeWindow();
        owner.AssignHandle(new System.Windows.Interop.WindowInteropHelper(window).Handle);
        System.Windows.Forms.DialogResult choice;
        try { choice = dialog.ShowDialog(owner); } finally { owner.ReleaseHandle(); }
        if (choice == System.Windows.Forms.DialogResult.OK) {
          var folder = dialog.SelectedPath;
          Find<TextBox>("InstallDirectory").Text = String.Equals(Path.GetFileName(folder), "Yan Agent", StringComparison.OrdinalIgnoreCase) ? folder : Path.Combine(folder, "Yan Agent");
        }
      }
    };
    Find<Button>("Continue").Click += delegate {
      try { selectedDirectory = ValidateDirectory(Find<TextBox>("InstallDirectory").Text); Find<TextBlock>("DirectoryError").Text = ""; ShowPage("PathPage"); Find<Button>("Install").Focus(); }
      catch (Exception error) { Find<TextBlock>("DirectoryError").Text = error.Message; }
    };
    Find<Button>("Back").Click += delegate { ShowPage("Welcome"); Find<TextBox>("InstallDirectory").Focus(); };
    Find<Button>("Install").Click += delegate {
      try {
        selectedDirectory = ValidateDirectory(selectedDirectory);
        Write("InstallDir", selectedDirectory);
        Write("AddToPath", Find<CheckBox>("AddToPath").IsChecked == true ? "1" : "0");
        installing = true; Find<Button>("Close").IsEnabled = false; ShowPage("ProgressPage");
        Write("Request", "install");
      } catch (Exception error) { installing = false; ShowFailure(error.Message); }
    };
    Find<Button>("FinishClose").Click += delegate { Write("Launch", "0"); window.Close(); };
    Find<Button>("Launch").Click += delegate { Write("Launch", "1"); window.Close(); };
    window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) {
      if (installing && !finished) { e.Cancel = true; return; }
      Write("Request", finished ? "done" : "cancel");
    };
    window.Closed += delegate { timer.Stop(); };
    window.ContentRendered += delegate { Write("Pid", Process.GetCurrentProcess().Id.ToString()); Write("Ready", "1"); };
    timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
    timer.Tick += Tick; timer.Start();
    new Application().Run(window);
  }

  internal static string ValidateDirectory(string input) {
    var text = (input ?? "").Trim();
    if (text.Length < 4 || text.Length > 180 || text.IndexOfAny(new char[] {'"','\r','\n','\t','*','?','|','<','>'}) >= 0 || text.Length < 3 || text[1] != ':' || text[2] != '\\') throw new ArgumentException("请输入有效的本地安装目录，例如 D:\\Yan Agent。");
    var full = Path.GetFullPath(text).TrimEnd('\\');
    if (full.Length <= 3) throw new ArgumentException("请选择磁盘中的文件夹，不要直接安装到根目录。");
    var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd('\\');
    if (full.Equals(windows, StringComparison.OrdinalIgnoreCase) || full.StartsWith(windows + "\\", StringComparison.OrdinalIgnoreCase) || File.Exists(full)) throw new ArgumentException("请选择可用于安装软件的文件夹。");
    foreach (var special in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments }) {
      var reserved = Environment.GetFolderPath(special).TrimEnd('\\');
      if (reserved.Length > 0 && full.Equals(reserved, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("请在所选位置下建立 Yan Agent 文件夹。");
    }
    var drive = new DriveInfo(Path.GetPathRoot(full));
    if (!drive.IsReady) throw new ArgumentException("所选磁盘不可用。");
    if (drive.AvailableFreeSpace < 2300L * 1024 * 1024) throw new ArgumentException("所选磁盘至少需要 2.3 GB 可用空间。");
    return full;
  }
  void ShowPage(string name) { foreach (var id in new[] {"Welcome","PathPage","ProgressPage","FinishPage"}) Find<FrameworkElement>(id).Visibility = id == name ? Visibility.Visible : Visibility.Collapsed; }
  void ShowFailure(string message) { finished = true; installing = false; Find<Button>("Close").IsEnabled = true; Find<TextBlock>("FinishTitle").Text = "安装未完成"; Find<TextBlock>("FinishCopy").Text = message; Find<Button>("Launch").Visibility = Visibility.Collapsed; ShowPage("FinishPage"); }
  static long DirectoryBytes(string root) {
    if (!Directory.Exists(root)) return 0;
    long total = 0;
    try { foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)) { try { total += new FileInfo(file).Length; } catch (IOException) {} } } catch (IOException) {} catch (UnauthorizedAccessException) {}
    return total;
  }
  async void Tick(object sender, EventArgs e) {
    try {
      if (finished) return;
      int parent;
      if (!preview && Int32.TryParse(Read("ParentPid", ""), out parent)) {
        bool alive;
        try { alive = !Process.GetProcessById(parent).HasExited; } catch (ArgumentException) { alive = false; }
        if (!alive) { ShowFailure("安装程序已退出，安装尚未完成。请重新运行安装程序。"); return; }
      }
      if (!installing) return;
      var phase = Read("Phase", "preparing");
      if (phase == "complete") { finished = true; installing = false; Find<Button>("Close").IsEnabled = true; ShowPage("FinishPage"); return; }
      if (phase == "failed") { ShowFailure("文件安装未能完成，请检查磁盘空间和文件占用后重试。"); return; }
      if (phase == "configuring") { UpdateProgress(98, "正在配置快捷方式与 PATH…"); return; }
      if (sampling) return;
      sampling = true;
      long kb; Int64.TryParse(Read("UnpackedKB", "0"), out kb);
      var extraction = Path.Combine(Path.GetDirectoryName(ini), "7z-out");
      var bytes = await Task.Run(() => DirectoryBytes(extraction));
      sampling = false;
      if (finished || !installing) return;
      int percent = kb > 0 ? (int)Math.Min(94, bytes * 94L / (kb * 1024L)) : 0;
      UpdateProgress(percent, percent >= 94 ? "正在安装文件与组件…" : bytes > 0 ? "正在解压文件… " + percent + "%" : "正在准备安装…");
    } catch (Exception error) { sampling = false; ShowFailure("读取安装状态失败：" + error.Message); }
  }
  void UpdateProgress(int percent, string text) { lastProgress = Math.Max(lastProgress, percent); Find<Border>("ProgressFill").Width = Math.Max(6, (window.ActualWidth - 130) * lastProgress / 100.0); Find<TextBlock>("ProgressLabel").Text = text; }
}
