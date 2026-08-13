---
name: yan-computer-use
description: Use the official Nuphus desktop tools to operate visible Windows applications. Apply when the user asks Yan Agent to open, control, click, type in, or complete a task in local desktop software.
---

# Yan Computer Use

Use the native desktop tools provided by [Nuphus MCP](https://github.com/mrpulor-gh/nuphus-mcp). Do not invent Yan-specific computer tools.

## Workflow

1. Call `desktop_windows_list` to find the target window. If the application is closed, launch it with an available process-launch tool, then list windows again.
2. Call `desktop_window_activate` with the target `hwnd` before observing or acting. Re-activate it whenever another window may have covered it.
3. Call `desktop_vision` once with a focused prompt to understand the current layout, text, controls, and state.
4. Call `desktop_perceive` to obtain exact UI element coordinates. Trust `desktop_vision` for meaning and text, but use only the `center` returned by `desktop_perceive` for mouse actions.
5. Act with `desktop_mouse`, `desktop_mouse_drag`, or `desktop_input`. Pass the target `hwnd` to `desktop_input` and use its atomic `send` option when appropriate.
6. Observe again only after an action could have changed the interface or when evidence shows the state is uncertain.
7. After the final action, perform one focused visual verification that the user's success condition is visible, then stop.

## Rules

- Never click coordinates estimated by `desktop_vision`.
- Never repeat screenshots or perception calls without an intervening action or a concrete reason.
- Keep the target window active before every click or input when focus may have changed.
- Use `double_click` only for controls or list items whose normal Windows interaction requires it.
- Use `desktop_clipboard_write` only for text longer than 500 characters. Never put secrets in the clipboard, and call `desktop_clipboard_clean` after pasting clipboard content.
- Do not use web tools for local desktop tasks. Nuphus browser tools are intentionally unavailable because Yan has a separate built-in browser.
- Do not claim success until the final observation shows the requested state.
