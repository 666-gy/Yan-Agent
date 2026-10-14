param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Windows.Automation;
public static class SnapshotText {
    static int count;
    static readonly StringBuilder output = new StringBuilder();
    static readonly Stopwatch clock = new Stopwatch();
    static readonly Dictionary<string, string> types = new Dictionary<string, string> {
        { "Button", "\u6309\u94ae" }, { "Calendar", "\u65e5\u5386" }, { "CheckBox", "\u590d\u9009\u6846" },
        { "ComboBox", "\u7ec4\u5408\u6846" }, { "Edit", "\u7f16\u8f91\u6846" }, { "Hyperlink", "\u8d85\u94fe\u63a5" },
        { "Image", "\u56fe\u7247" }, { "ListItem", "\u5217\u8868\u9879" }, { "List", "\u5217\u8868" },
        { "Menu", "\u83dc\u5355" }, { "MenuBar", "\u83dc\u5355\u680f" }, { "MenuItem", "\u83dc\u5355\u9879" },
        { "ProgressBar", "\u8fdb\u5ea6\u6761" }, { "RadioButton", "\u5355\u9009\u6309\u94ae" },
        { "ScrollBar", "\u6eda\u52a8\u6761" }, { "Slider", "\u6ed1\u5757" }, { "Spinner", "\u6570\u503c\u8c03\u8282\u5668" },
        { "StatusBar", "\u72b6\u6001\u680f" }, { "Tab", "\u6807\u7b7e\u680f" }, { "TabItem", "\u6807\u7b7e\u9875" },
        { "Text", "\u6587\u672c" }, { "ToolBar", "\u5de5\u5177\u680f" }, { "ToolTip", "\u5de5\u5177\u63d0\u793a" },
        { "Tree", "\u6811" }, { "TreeItem", "\u6811\u9879" }, { "Custom", "\u81ea\u5b9a\u4e49\u63a7\u4ef6" },
        { "Group", "\u7ec4" }, { "Thumb", "\u62d6\u52a8\u67c4" }, { "DataGrid", "\u6570\u636e\u8868\u683c" },
        { "DataItem", "\u6570\u636e\u9879" }, { "Document", "\u6587\u6863" }, { "SplitButton", "\u62c6\u5206\u6309\u94ae" },
        { "Window", "\u7a97\u53e3" }, { "Pane", "\u7a97\u683c" }, { "Header", "\u8868\u5934" },
        { "HeaderItem", "\u8868\u5934\u9879" }, { "Table", "\u8868\u683c" }, { "TitleBar", "\u6807\u9898\u680f" },
        { "Separator", "\u5206\u9694\u7ebf" }, { "SemanticZoom", "\u8bed\u4e49\u7f29\u653e" }, { "AppBar", "\u5e94\u7528\u680f" }
    };
    static string TypeName(ControlType type) {
        string name;
        return types.TryGetValue(type.ProgrammaticName.Replace("ControlType.", ""), out name) ? name : "\u63a7\u4ef6";
    }
    static void States(AutomationElement element) {
        var states = new List<string>();
        var info = element.Current;
        if (!info.IsEnabled) states.Add("\u5df2\u7981\u7528");
        if (info.IsOffscreen) states.Add("\u4e0d\u5728\u5c4f\u5e55\u5185");
        if (info.HasKeyboardFocus) states.Add("\u5df2\u805a\u7126");
        object pattern;
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
            states.Add(((SelectionItemPattern)pattern).Current.IsSelected ? "\u5df2\u9009\u4e2d" : "\u53ef\u9009\u62e9");
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
            var state = ((TogglePattern)pattern).Current.ToggleState;
            states.Add(state == ToggleState.On ? "\u5df2\u52fe\u9009" : state == ToggleState.Off ? "\u672a\u52fe\u9009" : "\u90e8\u5206\u52fe\u9009");
        }
        if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
            var state = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState;
            states.Add(state == ExpandCollapseState.Expanded ? "\u5df2\u5c55\u5f00" : state == ExpandCollapseState.Collapsed ? "\u5df2\u6298\u53e0" : state == ExpandCollapseState.PartiallyExpanded ? "\u90e8\u5206\u5c55\u5f00" : "\u53f6\u8282\u70b9");
        }
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            states.Add(((ValuePattern)pattern).Current.IsReadOnly ? "\u53ea\u8bfb" : "\u53ef\u7f16\u8f91");
        if (states.Count > 0) output.Append(" (").Append(String.Join("\u3001", states)).Append(')');
    }
    static bool Limited() { return count >= 1500 || output.Length >= 200000 || clock.ElapsedMilliseconds > 3000; }
    static void Walk(AutomationElement element, int depth) {
        if (element == null || depth > 24 || Limited()) return;
        try {
            var info = element.Current;
            output.Append(' ', depth * 2).Append(count++).Append(' ').Append(TypeName(info.ControlType));
            if (info.IsPassword) { output.AppendLine(" [\u53d7\u4fdd\u62a4]"); return; }
            States(element);
            output.Append(' ').Append(info.Name.Replace("\r", " ").Replace("\n", " "));
            if (!String.IsNullOrEmpty(info.AutomationId)) output.Append(" \u81ea\u52a8\u5316\u6807\u8bc6: ").Append(info.AutomationId);
            if (!String.IsNullOrEmpty(info.HelpText)) output.Append(" \u8bf4\u660e: ").Append(info.HelpText);
            if (!String.IsNullOrEmpty(info.AcceleratorKey)) output.Append(" \u5feb\u6377\u952e: ").Append(info.AcceleratorKey);
            if (!String.IsNullOrEmpty(info.AccessKey)) output.Append(" \u8bbf\u95ee\u952e: ").Append(info.AccessKey);
            object pattern;
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                var value = ((ValuePattern)pattern).Current.Value;
                if (!String.IsNullOrEmpty(value)) output.Append(" \u503c: ").Append(value.Length > 4000 ? value.Substring(0, 4000) : value);
            } else if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                var text = ((TextPattern)pattern).DocumentRange.GetText(4000);
                if (!String.IsNullOrEmpty(text)) output.Append(" \u6587\u672c: ").Append(text);
            }
            output.AppendLine();
            var walker = TreeWalker.ControlViewWalker;
            var child = walker.GetFirstChild(element);
            while (child != null && !Limited()) { Walk(child, depth + 1); child = walker.GetNextSibling(child); }
        } catch (ElementNotAvailableException) { } catch (InvalidOperationException) { }
    }
    public static string Capture(long handle) {
        var root = AutomationElement.FromHandle(new IntPtr(handle));
        output.Append("\u7a97\u53e3: \"").Append(root.Current.Name).AppendLine("\"");
        clock.Start(); Walk(root, 0);
        if (Limited()) output.AppendLine("[\u6587\u672c\u5feb\u7167\u5df2\u622a\u65ad]");
        return output.ToString();
    }
}
'@
[Console]::Write([SnapshotText]::Capture($WindowHandle))
