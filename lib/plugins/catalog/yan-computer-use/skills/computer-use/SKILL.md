---
name: computer-use
description: Control Windows apps from Yan Agent. Use for desktop application tasks that need window discovery, screenshots, accessibility controls, clicks, typing, scrolling, and verification.
---

# Computer Use

Activate the installed `yan-computer-use` plugin with `plugins_activate` when
needed, then use the tools and schemas returned for this session. If the plugin
or this skill is disabled, stop and explain the missing capability; do not create
another desktop driver or bypass the plugin with shell-based input automation.

Find the exact application and window. Read fresh `get_window_state` before
interacting. Prefer actionable element tokens when the accessibility tree exposes
the target. New snapshots invalidate previous tokens. If a control is missing,
use coordinates from that exact window screenshot; the driver handles scaling
from screenshot pixels to screen coordinates. Do not manually scale them twice.

Prefer background delivery. A successful delivery with `effect: unverifiable`
does not prove the app responded: inspect fresh state before deciding what to do
next. When background input has no effect, choose foreground delivery when
authorized. A refusal does not authorize escalation. For an unchanged loading
panel, avoid repeatedly taking identical screenshots without changing the plan;
check focus, the target control, or whether a second interaction is appropriate.

Use the user's configured image-input capability. Text-only models can act on
the accessibility tree; use existing `yan_media_read_image` with saved screenshot
paths for visual interpretation when its relay is configured. Do not add a vision
backend or infer multimodal support from the model name.

Before sending a message, verify the recipient and composed text. After any
action, check the relevant resulting state. Never repeat a delivered send unless
fresh state shows it did not succeed. Describe what the evidence establishes:
a playback UI is evidence of a playing state, and a sent message bubble is
evidence of client-side sending, not proof that every recipient read it.

Ordinary web tasks continue to use Yan Built-in Browser. Use this skill when
the requested workflow requires interacting with a Windows application.
