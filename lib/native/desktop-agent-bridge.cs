// Windows accessibility transport for Yan's own desktop collaboration feature.
// No model CLI, debugging port, credential access or application database writes.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

class DesktopAgentBridge {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static bool attempted;
    static void Result(object value) { Console.WriteLine("YAN_DESKTOP_BRIDGE_RESULT=" + json.Serialize(value)); }
    static string Get(Dictionary<string,object> r, string k) { return r.ContainsKey(k) ? Convert.ToString(r[k]) : ""; }
    static string Normal(string s) { return s.Replace("\r\n", "\n").TrimEnd('\r', '\n'); }
    static bool Matches(AutomationElement edit, string expected) {
        // Claude's accessibility ValuePattern collapses consecutive paragraph
        // breaks although clipboard input and its journal preserve them. Check
        // every other character here; the worker then verifies the exact full
        // message (including blank lines) against the desktop's own receipt.
        return Regex.Replace(Normal(Value(edit)), "\n+", "\n") == Regex.Replace(Normal(expected), "\n+", "\n");
    }
    static List<AutomationElement> Elements(AutomationElement root, ControlType type) {
        return root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, type))
            .Cast<AutomationElement>().Where(e => !e.Current.IsOffscreen).ToList();
    }
    static AutomationElement Window(string exe) {
        var found = new List<AutomationElement>();
        foreach (var p in Process.GetProcesses()) {
            using (p) { try {
                if (p.MainWindowHandle != IntPtr.Zero && String.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase))
                    found.Add(AutomationElement.FromHandle(p.MainWindowHandle));
            } catch (System.ComponentModel.Win32Exception) {} catch (InvalidOperationException) {} }
        }
        if (found.Count != 1) throw new Exception("需要一个可识别的桌面主窗口；请打开并登录应用，关闭多余窗口后检查任务");
        return found[0];
    }
    static string Value(AutomationElement e) {
        object pattern;
        if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return ((ValuePattern)pattern).Current.Value;
        if (e.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return ((TextPattern)pattern).DocumentRange.GetText(-1);
        throw new Exception("当前桌面版本无法读取输入框；未发送任务");
    }
    static bool Empty(AutomationElement e, AutomationElement root) {
        string value = Value(e).Trim();
        if (value.Length == 0) return true;
        // Chromium exposes contenteditable's visible aria-placeholder through
        // ValuePattern. Match only the observed empty-composer placeholders.
        if (value == e.Current.Name && new [] { "随心输入", "与 Codex 协作", "Work with Codex", "Ask anything", "Ask Codex", "Type a message" }.Contains(value)) return true;
        return e.Current.Name == "Prompt" && value == "Type / for commands" &&
            Elements(root, ControlType.Button).Any(b => b.Current.Name == "Send" && !b.Current.IsEnabled);
    }
    static AutomationElement Composer(AutomationElement root) {
        var trust = Elements(root, ControlType.Button).Any(e => new [] { "Trust workspace", "信任工作区", "Trust this folder" }.Contains(e.Current.Name));
        if (trust) throw new Exception("桌面应用请求信任工作区，请用户亲自在应用中确认；Yan 不会自动处理授权");
        var edits = Elements(root, ControlType.Edit).Where(e => e.Current.IsEnabled && !e.Current.IsPassword).ToList();
        var named = edits.Where(e => {
            string n = e.Current.Name.ToLowerInvariant();
            return n == "prompt" || n.Contains("message") || n.Contains("follow-up") || n.Contains("ask") || n.Contains("消息") || n.Contains("询问") || n.Contains("后续");
        }).ToList();
        if (named.Count == 1) return named[0];
        if (edits.Count == 1) return edits[0];
        throw new Exception("无法唯一识别任务输入框；请切到 Code 本地会话，处理登录或确认弹窗");
    }
    static void Marker(AutomationElement root, string marker) {
        if (String.IsNullOrEmpty(marker)) throw new Exception("缺少目标会话标识");
        var feeds = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, "Chat messages"));
        // A marker may have scrolled above the viewport. Claude's current chat
        // feed excludes sidebar titles and other chats, so it is safe to inspect
        // its offscreen message nodes without navigating or changing selection.
        var scope = feeds.Count == 1 ? feeds[0] : root;
        foreach (AutomationElement e in scope.FindAll(TreeScope.Descendants, Condition.TrueCondition)) {
            if ((feeds.Count == 1 || !e.Current.IsOffscreen) && e.Current.ControlType != ControlType.Edit && e.Current.Name.Contains(marker)) return;
        }
        throw new Exception("桌面当前不是本任务会话；请返回包含任务标识的会话，Yan 不会向其他会话发送");
    }
    static void CheckWorktree(AutomationElement root) {
        if (Elements(root, ControlType.Button).Any(e => new [] { "Worktree", "工作树" }.Contains(e.Current.Name)))
            throw new Exception("桌面当前选择了工作树；请切换到本地原工作目录");
        foreach (var e in Elements(root, ControlType.CheckBox)) {
            if (e.Current.Name.IndexOf("worktree", StringComparison.OrdinalIgnoreCase) < 0) continue;
            object p;
            if (!e.TryGetCurrentPattern(TogglePattern.Pattern, out p) || ((TogglePattern)p).Current.ToggleState != ToggleState.Off)
                throw new Exception("桌面启用了 worktree；请切换到原工作目录后再派发");
        }
    }
    static void CheckIdle(AutomationElement root) {
        if (Elements(root, ControlType.Button).Any(e => e.Current.IsEnabled &&
            new [] { "Stop", "Stop generating", "Stop response", "Stop task", "停止", "停止生成", "停止任务", "停止响应" }.Contains(e.Current.Name)))
            throw new Exception("原桌面任务仍在运行，请等待完成；Yan 不会插入或排队发送另一条任务");
    }
    static bool HasMarker(AutomationElement root, string marker) {
        try { Marker(root, marker); return true; } catch { return false; }
    }
    static AutomationElement Resume(Dictionary<string,object> request, string exe, string provider) {
        string marker = Get(request, "marker"), url = Get(request, "url");
        bool valid = provider == "codex"
            ? Regex.IsMatch(url, @"^codex://threads/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$")
            : Regex.IsMatch(url, @"^claude://code/continue\?session=local_[A-Za-z0-9-]{1,64}$");
        if (!valid || String.IsNullOrEmpty(marker)) throw new Exception("缺少有效的原桌面任务地址；不会新建会话");
        AutomationElement current = null; try { current = Window(exe); } catch {}
        // Historical text is not a Yan nonce: always navigate to the exact
        // selected id before checking it, even if another window has that text.
        bool historyTarget = request.ContainsKey("historyTarget") && Object.Equals(request["historyTarget"], true);
        if (!historyTarget && current != null && HasMarker(current, marker)) return current;
        if (current != null) {
            AutomationElement edit = null; try { edit = Composer(current); } catch {}
            if (edit != null && !Empty(edit, current)) throw new Exception("桌面当前会话有草稿，请先保存；Yan 不会覆盖或切走");
        }
        // Navigating to a fixed existing id is repeatable and never creates a
        // conversation. Sending remains protected by its exclusive intent.
        Process.Start(new ProcessStartInfo(exe, "\"" + url + "\"") { UseShellExecute = true });
        for (int i = 0; i < 30; i++) {
            Thread.Sleep(500);
            AutomationElement root = null; try { root = Window(exe); } catch {}
            if (root != null && HasMarker(root, marker)) return root;
        }
        throw new Exception("无法打开已关联的桌面任务，请在应用中恢复原任务；Yan 不会新建会话");
    }
    static void Focus(AutomationElement root, AutomationElement edit) {
        var h = new IntPtr(root.Current.NativeWindowHandle);
        if (IsIconic(h)) ShowWindow(h, 9);
        SetForegroundWindow(h); edit.SetFocus(); Thread.Sleep(150);
        if (GetForegroundWindow() != h || !Automation.Compare(AutomationElement.FocusedElement, edit))
            throw new Exception("输入焦点被其他窗口占用；未发送任务");
    }
    static void Paste(AutomationElement root, AutomationElement edit, string text) {
        // Preserve clipboard contents and never log them. Recheck before restoring
        // so a clipboard copied by the user during the operation is not overwritten.
        Focus(root, edit);
        System.Windows.Forms.IDataObject old = Clipboard.GetDataObject();
        Clipboard.SetText(text, TextDataFormat.UnicodeText);
        uint seq = GetClipboardSequenceNumber();
        try {
            SendKeys.SendWait("^v"); Thread.Sleep(300);
            if (!Matches(edit, text)) throw new Exception("输入回读与完整任务不一致；未点击发送，保留草稿供检查");
        } finally {
            if (GetClipboardSequenceNumber() == seq) {
                if (old != null) Clipboard.SetDataObject(old, true); else Clipboard.Clear();
            }
        }
    }
    static void Send(AutomationElement root, AutomationElement edit, string text, string marker, string intent) {
        if (!String.IsNullOrEmpty(marker)) Marker(root, marker);
        if (!Matches(edit, text)) throw new Exception("发送前任务校验失败");
        CheckWorktree(root);
        CheckIdle(root);
        var buttons = Elements(root, ControlType.Button).Where(e => e.Current.IsEnabled &&
            new [] { "Send", "Send message", "Submit", "发送", "发送消息", "提交" }.Contains(e.Current.Name)).ToList();
        if (buttons.Count != 1) throw new Exception("无法唯一识别发送按钮；未发送任务");
        object p;
        if (!buttons[0].TryGetCurrentPattern(InvokePattern.Pattern, out p)) throw new Exception("桌面发送按钮不支持辅助功能调用");
        if (File.Exists(Path.Combine(Path.GetDirectoryName(intent), "cancel.json"))) throw new Exception("用户已取消，未点击发送");
        // Exclusive durable intent BEFORE the one irreversible click. A timeout,
        // crash or ambiguous Invoke result must never lead to a second click.
        using (var f = new FileStream(intent, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
            byte[] bytes = Encoding.UTF8.GetBytes(DateTime.UtcNow.ToString("o"));
            f.Write(bytes, 0, bytes.Length); f.Flush(true);
        }
        attempted = true;
        ((InvokePattern)p).Invoke();
    }
    [STAThread]
    static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length != 1) throw new Exception("Expected one request file");
            var r = json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0], Encoding.UTF8));
            string exe = Path.GetFullPath(Get(r, "executable")), provider = Get(r, "provider"), action = Get(r, "action");
            var version = FileVersionInfo.GetVersionInfo(exe);
            if ((provider != "claude" && provider != "codex") ||
                (version.ProductName ?? "").IndexOf(provider, StringComparison.OrdinalIgnoreCase) < 0 ||
                !File.Exists(Path.Combine(Path.GetDirectoryName(exe), "resources", "app.asar")))
                throw new Exception("目标不是已验证的桌面程序");
            using (var mutex = new Mutex(false, @"Local\YanDesktopAgentInput")) {
                bool held = false;
                try {
                    try { held = mutex.WaitOne(5000); } catch (AbandonedMutexException) { held = true; }
                    if (!held) throw new Exception("另一个桌面派发正在输入，请稍后检查");
                    if (File.Exists(Get(r, "intent"))) throw new Exception("该轮发送动作已有记录，不会重复发送");
                    if (action == "open") {
                        string navigation = Get(r, "openIntent");
                        if (!File.Exists(navigation)) {
                            AutomationElement old = null; try { old = Window(exe); } catch {}
                            if (old != null) {
                                AutomationElement draft = null; try { draft = Composer(old); } catch {}
                                if (draft != null && !Empty(draft, old))
                                    throw new Exception("桌面输入框已有草稿，请先保存或发送草稿；Yan 不会覆盖");
                            }
                            var uri = new Uri(Get(r, "url"));
                            if (uri.Scheme != provider) throw new Exception("Invalid desktop URL");
                            using (var marker = new FileStream(navigation, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { marker.Flush(true); }
                            Process.Start(new ProcessStartInfo(exe, "\"" + uri.AbsoluteUri + "\"") { UseShellExecute = true });
                        }
                        string text = Get(r, "text");
                        Exception last = null;
                        for (int i = 0; i < 30; i++) {
                            Thread.Sleep(500);
                            try {
                                var window = Window(exe); var edit = Composer(window);
                                if (!Matches(edit, text)) continue;
                                Send(window, edit, text, "", Get(r, "intent"));
                                Result(new { ok = true, sent = true }); return 0;
                            } catch (Exception e) { if (attempted) throw; last = e; }
                        }
                        throw last ?? new Exception("桌面未显示指定工作区的新会话；请检查应用提示，未发送任务");
                    }
                    if (action != "send" && action != "resume") throw new Exception("Unsupported operation");
                    var root = action == "resume" || !String.IsNullOrEmpty(Get(r, "url")) ? Resume(r, exe, provider) : Window(exe);
                    Marker(root, Get(r, "marker"));
                    CheckIdle(root);
                    var composer = Composer(root);
                    string assignment = Get(r, "text");
                    if (!Matches(composer, assignment)) {
                        if (!Empty(composer, root)) throw new Exception("会话中已有其他草稿，未覆盖");
                        Paste(root, composer, assignment);
                    }
                    Send(root, composer, assignment, Get(r, "marker"), Get(r, "intent"));
                    Result(new { ok = true, sent = true }); return 0;
                } finally { if (held) mutex.ReleaseMutex(); }
            }
        } catch (Exception e) {
            Result(new { ok = false, beforeSend = !attempted, error = e.Message }); return 1;
        }
    }
}
