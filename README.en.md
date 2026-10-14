# Yan Agent

[中文](README.md) · [English](README.en.md)

**An open-source AI agent that works in your real workspace.**

Yan Agent is a Windows desktop application. Connect your preferred model service to understand projects, edit code, use browser and desktop tools, track progress, steer tasks, and review results in one place.

## Download and get started

Current release: **v1.7.0 · Windows x64**.

- [Windows installer](https://github.com/ViaTumLab/Yan-Agent/releases/download/v1.7.0/Yan.Agent.Setup.v1.7.0.exe)
- [Baidu Netdisk mirror](https://pan.baidu.com/s/1KZIFg29V7Ks89pvEWiY4mw?pwd=code), access code: `code`
- [All releases](https://github.com/ViaTumLab/Yan-Agent/releases)

1. Install and launch the application. Configure a model service endpoint, API key, and protocol.
2. Refresh the model list, enable models, and select the main model for your task.
3. Select a workspace and describe your goal, constraints, and acceptance criteria. Attach files, images, or application snapshots as needed.
4. Follow progress, add guidance, and handle permission requests. Review file changes and test results when the task completes.

## Features

| Capability | Purpose |
| --- | --- |
| Engineering tasks | Understand projects, investigate bugs, edit code, develop features, and run tests and acceptance checks with tools. |
| Subagents | Delegate tasks in parallel, configure subagent models, track progress, and review results. |
| External agents | Collaborate with Codex, Claude, and Reasonix Studio by dispatching tasks and reading results. |
| Workspaces and Git | Manage projects, branches, and worktrees; inspect changes and handle code review and PR tasks. |
| Built-in browser | Browse, sign in, download files, annotate pages, export PDFs, and verify wide and narrow layouts. |
| Computer control | Operate Windows applications, manage allowlists and experience, and download experience as Markdown for sharing. |
| Application snapshots | Capture external application windows and add their images and context to conversations. |
| Plugins, skills, and MCP | Install extensions, connect accounts, import skills, and connect tools, including Playwright browser automation. |
| Multimodal workflows | Configure text, image, and video services; view and annotate images; use voice input and read-aloud. |
| LAN WebUI | Manage and continue desktop tasks from a phone or another device on the same local network. |
| Conversations and personalization | Manage archives, references, and exports; configure memory, fonts, wallpapers, sounds, and permissions. |

## Models and services

The project includes adapter paths for OpenAI, Anthropic, Gemini, DeepSeek, Qwen, GLM, Kimi, and others. Select models per task. Model availability, tool calling, and multimodal capabilities depend on the configured service. Providers charge their own service fees.

Plugins and external agents may require separate installations, accounts, or credentials. A successful connection does not imply support for every tool or media endpoint. LAN WebUI access requires the computer running Yan Agent to remain online.

## Run from source

Use Windows x64, Node.js, and npm:

```powershell
git clone https://github.com/ViaTumLab/Yan-Agent.git
cd Yan-Agent
npm ci
npm start
```

Use `npm run dev` for development. Prepare desktop bridges, computer control, and Playwright runtimes with `npm run build:desktop-bridge`, `npm run build:cua-driver`, and `npm run build:playwright` as needed. Build scripts may download components.

## Testing and building

```powershell
npm test
npm run build
```

`npm run build` produces the Windows installer and runs packaged-runtime checks. `npm run build:release` also produces a portable application. Outputs are written to `dist/`. Building requires Windows and the corresponding system tools. End-to-end tests in `test/` may require desktop applications, accounts, or model services.

## Data and permissions

Conversations, configuration, workspace state, and experience are stored locally. Model and third-party tool calls send the content needed for the task to the corresponding services. Manage tool access through permission prompts and application allowlists. Check conversations, screenshots, and experience files for private information before sharing. The WebUI is intended for local-network access; do not expose its port directly to the public internet.

## Feedback and contributions

Report problems through [Issues](https://github.com/ViaTumLab/Yan-Agent/issues), including the version, reproduction steps, expected and actual behavior, and sanitized logs or screenshots. Pull requests are welcome. Run relevant checks and describe validation. Do not commit credentials, personal data, or build caches.

## License

Licensed under the [MIT License](LICENSE). Third-party components and plugins retain their own licenses. See [third-party notices](lib/THIRD_PARTY_NOTICES.md) and [skill notices](lib/skills/THIRD_PARTY_NOTICES.md).
