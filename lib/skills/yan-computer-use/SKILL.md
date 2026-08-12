---
name: Yan Computer Use
description: 让 Agent 操控用户本地 Windows 软件，不锁定键鼠，Esc 退出。
version: 1
---

## 触发词

- 电脑操控
- Computer Use
- 控制我的电脑
- 帮我操作

## 用法

当用户要求操控某个 Windows 软件时，调用 `start_computer_use({ targetTitle })` 启动电脑操控。启动前 Yan Agent 会通过视觉中继面板询问用户是否启用视觉中继；用户确认后进入操控模式。

操控期间不锁定用户键鼠；若目标窗口被其他窗口覆盖，系统会自动将其置前并继续工作。用户可随时按 `Esc` 退出电脑操控模式。

## 可用动作

- `start_computer_use({ targetTitle, targetHwnd?, useVisionRelay? })`：启动电脑操控。
- `stop_computer_use()`：停止电脑操控。
- `computer_click({ x, y })`：在目标窗口内点击指定坐标。
- `computer_type({ text })`：在目标窗口输入文本。
- `computer_screenshot()`：截取目标窗口截图。
