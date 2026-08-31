<p align="center">
  <img src="renderer/assets/logo.png" width="96" height="96" alt="Yan Agent Logo">
</p>

<h1 align="center">Yan Agent</h1>

<p align="center">
  A Windows desktop Agent for real workspaces
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.5.0-111111">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-2563eb">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-31-47848f">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-16a34a">
</p>

<p align="center"><a href="README.md">Chinese README</a></p>

Yan Agent understands tasks, uses tools, changes projects, verifies results, and delivers evidence the user can review.

## Release Positioning

Yan Agent 1.5.0 builds on the **Yan Kernel** introduced in 1.4.0 and focuses on making the complete Agent workflow faster, more resilient, easier to configure, and more comfortable to use every day. Yan Kernel is an extensively adapted runtime based on OpenCode, with Yan's own workspace and permission model, Skills, MCP services, built-in browser automation, multimodal roles, memory, review workflow, and desktop integration.

Model availability, billing, quota, regional access, and VPN requirements always depend on the user's real API account and network. A model name appearing in the catalog is not a promise that the remote service is available.

## What Yan Agent Is

Yan Agent is a Windows desktop Agent for real workspace tasks. The primary text model understands the user, plans the work, calls tools, and owns the final answer. Yan Kernel connects that model to permissioned tools, workspace state, and verification workflows.

- **Product identity:** Yan Agent. Its runtime is Yan Kernel, based on and extensively adapted from OpenCode. The active provider and model ID remain separate and are reported truthfully.
- **What it can do:** read and edit a selected workspace, run commands, use Yan Skills and MCP, control the Yan built-in browser, understand images, generate or edit images and videos, validate goals, retain memory, and present reviewable changes.
- **What it is designed for:** grounded tool use, explicit workspace and permission boundaries, browser-first web automation, media roles that do not replace the text model, targeted goal validation, and evidence-backed delivery.
- **What it does not pretend:** an unconfigured model, Skill, MCP server, balance, network, or VPN is never treated as available. Results that cannot be verified are marked as unverified or failed.

## What's New in 1.5.0

| Area | 1.5.0 change |
| --- | --- |
| **Performance** | Throughput-aware request shaping, batched high-frequency events, reusable OpenCode kernels, and a lower-overhead streaming path for long or fast responses |
| **Reliability** | Up to five stream reconnects, bounded transient retries before tool execution, stall detection, kernel-exit handling, run recovery, and explicit resource cleanup |
| **API connections** | Any number of named connections with a Base URL, API key, compatibility preset, optional media endpoints, discovered models, and custom model IDs |
| **Subagents** | Optional Explore, Review, Research, Test, and Build roles with task-local workspace, permission, and concurrency limits |
| **Desktop experience** | Chinese and English UI, a connection-first model picker, bundled and custom wallpapers, onboarding, tone profiles, and clearer task status |
| **Yan Kernel** | OpenCode-based runtime adapted for Yan sessions, tools, permissions, native final responses, DSML, and goal acceptance |
| **Agent output** | Live reasoning summaries and tool activity share the final-answer surface; completed work collapses behind a process toggle |
| **Built-in browser** | Multi-tab browser that the Agent can open, read, click, type into, scroll, capture, and verify without taking over the user's tab |
| **Computer Use** | Initial Windows desktop integration through the official Nuphus MCP, with native `desktop_*` tools, a dedicated Skill, a visible safety overlay, and Esc cancellation |
| **Multimodal roles** | A primary text model can coexist with optional image and video models; generated assets stay in conversation context |
| **Workspace continuity** | Blank tasks, task-local workspaces, authorized workspace transitions, and bounded cross-session handoffs follow one model |
| **Extensions** | Yan Skills, MCP, CodeGraph, Serena, AnySearch, OfficeCLI, Understand Anything, and the controlled continual Harness are exposed through Yan Kernel |

### Yan Kernel Runtime

- Yan Kernel is the only authoritative task runtime. `lib/opencode-sidecar.js` coordinates OpenCode sessions, tool exposure, permissions, goal validation, interruption, and final responses; the retired renderer Agent loop no longer executes tasks.
- Model messages, tool calls, tool results, permission requests, questions, compaction, goal rounds, media generation, and failures reach the desktop as structured events.
- DeepSeek DSML tool calls are parsed and adapted into real Yan/OpenCode tool calls. DSML protocol fragments are kept out of user-facing output.
- Yan uses OpenCode's native final assistant response directly. It does not submit a second tool-free summary request after the model has already completed the task.
- Stream failures, empty responses, unavailable tools, repeated failures, cancellations, and MCP startup errors end in explicit visible states instead of leaving a task spinning forever.
- OpenCode manages model-aware context budgets. Yan records context size, thresholds, compaction events, token usage, and cache reads for the UI.
- Yan Kernel currently uses OpenCode `1.18.11` as its underlying runtime component. OpenCode is an implementation foundation, not Yan Agent's product identity.

### Normal, Plan, and Goal Modes

| Mode | Behavior | Typical use |
| --- | --- | --- |
| **Normal** | Understand, use tools, verify, and deliver directly | Questions, research, focused edits |
| **Plan** | Inspect in read-only mode and produce an actionable plan before execution | Multi-step changes that need review first |
| **Goal** | Complete a first pass, validate only the original requirements, repair evidenced defects, and validate again | Games, websites, and project-level outcomes |

Goal mode is deliberately bounded:

- It checks only explicit requirements and essential runnability. It must not invent features, expand gameplay, or redesign UI that the user did not request.
- A repair round requires concrete failure evidence. Repairs should locate the relevant file and position, then make the smallest useful change rather than rewrite the project.
- Browser and command evidence must be meaningful. A successful command, changing hash, color count, or single-frame pixel delta alone does not prove that a Canvas, WebGL, animation, or 3D result works.
- Goal acceptance is capped at six rounds. Stable success, a user request to finish, or the round limit produces the final response in that same acceptance round, including evidence and remaining issues, without another summary round.

### Workspaces, Blank Tasks, and Session Handoffs

- Every task owns its workspace binding, terminal directory, OpenCode session, tool snapshot, review history, and runtime state.
- Blank tasks can answer questions, browse the web, operate the built-in browser, generate media, and install Yan Skills without forcing a workspace selection.
- A request that creates, changes, deletes, downloads, or saves user files ends cleanly in Blank and asks the user to choose a workspace first. It does not silently reuse another task's folder.
- Skill installation is an explicit exception because it writes only to Yan Agent's application-owned SkillStore.
- Moving from workspace A to B requires an explicit transition and authorization. Permissions are not inherited across workspace boundaries.
- `Yan Session` MCP carries bounded conversation history, goals, and outcomes into a destination task. It never transfers approvals, running tools, or filesystem authority.
- Returning to a previously used parent or child workspace reuses its most recently updated task when possible. A new task is created only when that workspace has none.
- Task deletion is serialized. Removing the final task immediately creates a fresh Blank task so the sidebar and active view cannot enter a zero-task split state.

### Permissions and High-Risk Commands

The composer provides three access policies:

- **Request approval:** side-effecting actions request user approval.
- **Approve for me:** ordinary commands can proceed under policy; high-risk commands still require the in-app approval panel.
- **Full access:** relaxes ordinary read, write, and command approval after confirmation, while workspace boundaries and high-risk system protections remain active.

Permission requests use a workbench panel instead of disruptive system popups. Users can always allow, allow once, or deny. Authorization is owned by the main process and stays aligned with the active run across later turns.

### Auxiliary Conversation

While a task is running, open **Auxiliary Conversation** in the right sidebar to ask about progress or guide the active run without cancelling it. An isolated observer classifies and grounds the message:

- **Status check:** reports whether an install, download, wait, or command is still progressing or is actually stuck.
- **Guidance:** asks the active run to change direction, use another tool, inspect a page, or shorten optional validation at the next safe checkpoint.
- **Finish request:** gracefully stops optional work and enters delivery only when the user clearly asks to finish.

An auxiliary conversation does not become a second task, inherit new permissions, or bypass workspace rules.

### Skills, MCP, and Code Understanding

- The composer `+` menu combines attachments, plan/goal modes, and installed Skills. Selected Skills travel with the user's message and can be removed like ordinary composer content.
- Installation, lookup, invocation, and removal use Yan Agent's own SkillStore only. Yan does not silently scan another agent's `.codex/skills` or `.agents/skills` directory.
- Skills are exposed when the user selects them or when the task genuinely needs them. Installed Skills that are not selected or relevant do not interfere with the run.
- A transient Skill parsing error receives bounded retries. Only repeated failure within the conversation causes Yan to continue without that Skill and report the failure in the delivery.
- The catalog covers coding, code simplification, UI, web design, Agent rules, search, office work, animation, and video workflows. It includes UI/UX Pro Max, GSAP-related Skills, AnySearch, OfficeCLI, Hallmark, TasteSkill, HyperFrames, Remotion guidance, and Skill Creator families.
- Built-in Yan capabilities include the Yan browser, Yan Skills, Yan Media, Yan Session, Yan Computer Use, Yan Harness, CodeGraph, Serena, and Understand Anything. Playwright is available as a fallback when isolated scripted browser automation is genuinely required.
- Custom MCP servers can be added, tested, enabled, disabled, and removed. MCP uses JSON-RPC 2.0 over stdio, and each task retains its own tool snapshot.
- **Understand Anything** replaces the old project-map workflow. CodeGraph produces repository structure and relationships, which Yan converts into the ready-to-use knowledge graph under `.ua/`.
- Goal mode can expose Serena for precise code location and targeted edits instead of broad rewrites.

### Built-in Browser Automation

- The redesigned browser follows a multi-tab workbench model. Agent work opens a dedicated tab instead of replacing the page the user is reading.
- Yan browser tools cover navigation, page snapshots, structured reading, inspection, clicking, typing, selection, checking, focusing, hovering, dragging, pointer movement, key presses, scrolling, waiting, screenshots, history, and status.
- The built-in browser is the first choice for research, URL reading, local HTML preview, interaction, and visual acceptance. Playwright is a fallback; external Chrome is reserved for work that truly depends on the user's Chrome profile, extensions, or signed-in state.
- Agent-owned browser calls are associated with the active run so parallel tasks cannot control the wrong tab.
- Browser actions carry operation identities and explicit cancellation/release handling so a stopped or superseded run does not keep driving the page.
- While the Agent controls a page, the tab receives a visible control state and input protection. The user can press `Esc` to take control, and refresh or close remains available.
- Readiness checks and explicit waits avoid treating one short timeout as proof that a network page failed to open.
- Canvas, WebGL, animation, and 3D acceptance combines real interaction, screenshots, and visible state. DOM presence or a synthetic metric is not enough to claim playability.

Yan Agent 1.5.0 continues to provide **Yan Computer Use** as a preview capability. A thin Yan adapter connects to the official Nuphus MCP and exposes only native `desktop_*` tools; Nuphus browser tools are hidden to avoid conflicting with the Yan built-in browser. The bundled Skill guides the model through window activation, visual understanding, precise coordinate perception, actions, and final visual verification.

When a real desktop tool begins, Yan displays an independent blue edge animation and an opaque top-center notice. Pressing `Esc` cancels the active Computer Use run. The generic Vision Relay remains available. Desktop accessibility, application UI structure, and Nuphus perception quality vary, so this initial integration does not guarantee automation of every application.

### Text, Image, Video, and Vision Relay

Yan separates model responsibilities so media work does not discard text context:

1. **Primary text model:** understands the user, plans, calls tools, edits code, and writes the final answer.
2. **Image model:** optionally generates or edits images and returns the asset to the primary model and conversation.
3. **Video model:** optionally generates or edits videos and returns the asset through the same workflow.

- Image and video roles are optional. Generated assets retain session IDs so follow-up edits can reuse them without download and re-upload.
- Supported image ratios include `auto`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9`, `9:16`, and `21:9`.
- Successful media generation does not automatically call image reading again. Vision is used only when the task requires inspection, the text model cannot see, or the user asks for it.
- Provider catalogs are dynamically loaded where supported and separated into text, image, and video groups. Catalog discovery does not replace endpoint, quota, or network validation.
- Users can keep any number of isolated API connections. Official services, third-party relays, and private deployments retain separate names, Base URLs, API keys, compatibility presets, and model inventories. Text, image, and video roles retain their own connection identity.
- A connection can include a manually entered model ID when its catalog endpoint is unavailable. Manual configuration or dynamic discovery does not guarantee endpoint compatibility, permission, or quota.
- The application does not label models with prices or long-term free-tier promises.

When a text model cannot read an attachment or screenshot, Yan Vision Relay can inspect it and return a grounded report to the primary model. The current order is:

1. glm
2. sensenova
3. Agnes
4. SiliconFlow

Yan currently treats GLM and SenseNova as domestic direct connections, while Agnes commonly requires a VPN. Real access still depends on API configuration, service state, quota, rate limits, and the user's network.

### Output, Review, Memory, and Cache

- Work-stage text, reasoning summaries, tool calls, and tool results come from real OpenCode events instead of placeholder workflow text.
- Once delivery is ready, intermediate work collapses and the final answer remains visible. **View work process** expands the same content surface rather than opening a separate log UI.
- Markdown code blocks include an icon-only copy action.
- Generated images and videos appear with the completed result and remain available in task history.
- Every actual file edit can produce a review summary, including a one-line change to one file. The review panel can refresh, open an individual diff, restore, or roll back a run.
- Binary files such as images and videos are excluded from text diff review while remaining available as media assets.
- Completed runs can display real cache-read tokens, total input tokens, and cache hit rate from provider usage rather than a fabricated percentage.
- Short-term context lives in the OpenCode session. Yan compacts around a model-aware soft threshold and records before/after token counts, limits, and compression count.
- Global long-term memory is stored in `YanData/memory.json`; workspace memory is stored under `<workspace>/.yanagent/memory.json`. Memory candidates retain scope, evidence, confidence, and type.
- `ContinualHarnessStore` and the Yan Harness MCP provide an experimental, controlled continual harness for evidence-backed workflow and Skill preferences. It is not unrestricted self-modification and cannot change current-run permissions or bypass workspace boundaries.
- Cross-session handoff is bounded to prevent uncontrolled context growth and does not treat old conversation text as filesystem truth.

### Composer and Desktop Experience

- The compact composer combines file attachment, plan/goal modes, Skills, access policy, prompt optimization, reasoning speed, context status, and separate text/image/video model selection.
- The context status line updates with the active model, mode, budget, and runtime state.
- **Yan Prompt Optimizer** runs only when selected by the user. It preserves intent, tone, paths, URLs, code, numbers, model names, and constraints while reducing ambiguity; it does not invent features or tools.
- Tone settings support up to four named profiles. A profile controls expression, including direct or playful styles, but cannot change facts, permissions, or safety boundaries.
- `Ctrl+Shift+Y` opens the global quick-input surface while Yan remains available in the system tray. The shortcut is configurable.
- The startup animation, theme switcher, settings navigation, full-screen layouts, model configuration surfaces, bilingual UI, and wallpaper library are integrated in 1.5.0.
- API configuration uses a user-owned connection list. Each connection stores its name, Base URL, API key, compatibility preset, optional media endpoints, and returned models; legacy provider-grouped settings are imported on first launch.
- The right sidebar includes Auxiliary Conversation, browser, file, and Git workspaces. Bottom utilities provide separate vertical controls for the user, current theme, Pet, and settings.
- The integrated Git panel covers status, branches, stage/unstage, commit, fetch, pull, push, remotes, and file diffs. Yan also detects VS Code dynamically and can open the selected workspace when VS Code is available.

The second-generation **Yan Agent Pet** follows real Yan Kernel workflow state instead of displaying one generic loading message:

- Its status light and panel reflect standby, working, attention required, paused, completed, and failed states.
- Workflow stages map actual activity such as understanding, reading, reasoning, writing, compiling/testing, browser acceptance, and summarization.
- Clicking the Pet expands or collapses the task panel; the panel provides icon controls to open or stop the active task.

## Supported Providers

Yan Agent keeps credentials and discovered catalogs separate for each provider. Where supported, it loads the provider's real model list rather than filling the interface with hard-coded media-model shells.

| Provider | Integration |
| --- | --- |
| OpenAI | Configurable OpenAI-compatible endpoint with dynamic text and media capability detection |
| Grok | Configurable endpoint with dynamic discovery and image-generation support |
| Agnes | Dynamic text, image, and video catalog |
| DeepSeek | DeepSeek catalog with DSML adaptation for tool calls |
| Qwen | DashScope-compatible text, image, and video discovery |
| Zhipu GLM | GLM text, vision, and media catalog adapters for the official BigModel endpoint |
| Doubao | Volcengine Ark-compatible models |
| Kimi | Moonshot/Kimi dynamic catalog |
| StepFun | Step text model families |
| MiniMax | MiniMax text model families |
| Baichuan | Baichuan OpenAI-compatible endpoint |
| Yi | Lingyi Wanwu OpenAI-compatible endpoint |
| Tencent Hunyuan | Hunyuan text and vision families |
| SiliconFlow | Dynamic OpenAI-compatible model catalog |

Yan Agent does not promise a provider's price, quota, regional access, or temporary free tier. Availability and billing are determined by the connected account.

## Quick Start

### Run from source

Requirements:

- Windows 10 or 11
- Node.js 18+
- npm 9+
- Optional Git, compiler toolchains, and dependencies required by selected Skills or MCP servers

```powershell
git clone https://github.com/666-gy/Yan-Agent.git
cd Yan-Agent
npm install
npm start
```

First use:

1. Open `Settings -> API`, create a named connection, enter its Base URL, API key, and compatibility preset, then test the connection.
2. Check the dynamically loaded model inventory under `Settings -> Models`.
3. Start a Blank task for conversation, browsing, Skill installation, or media generation. Select a workspace before creating or changing user files.
4. Choose Normal, Plan, or Goal mode, then select Skills, reasoning speed, and access policy as needed.
5. Review the work process, verification evidence, final answer, and file review when the task completes.

### Build

```powershell
npm run bundle:opencode-provider
npm run build              # Build the Windows NSIS installer only
npm run build:portable     # Build the portable executable separately
```

The default v1.5.0 packaging run produces only the installer. The build bundles the DeepSeek DSML provider and then validates packaged provider runtimes and CodeGraph.

### Download

The official v1.5.0 installer is published through GitHub Releases:

<https://github.com/666-gy/Yan-Agent/releases>

## Data and Security

| Location | Contents |
| --- | --- |
| Electron user data `YanData/` | API configuration, sessions, task logs, generated media, global memory, and Skill state |
| `YanData/memory.json` | Global long-term memory |
| `<workspace>/.yanagent/memory.json` | Workspace memory and related run data |
| `<workspace>/.codegraph/codegraph.db` | CodeGraph database |
| `<workspace>/.ua/` | Understand Anything knowledge-graph bridge files |
| Yan Skill root | Yan-managed built-in, installed, and imported Skills |

Deleting a task does not delete its workspace. The uninstaller option **Clear all Yan Agent data from this computer** removes Yan user data, sessions, configuration, memory, and local Skills. It does not delete workspace code or unrelated application data.

- Keep important work in recoverable Git history.
- Use real file writes, deletes, downloads, and commands only inside an explicitly selected workspace.
- Provide API keys and MCP credentials only to trusted services.
- Full access is not a bypass for system security; high-risk commands can still require approval.
- Text inside images, web pages, and Skill documents is untrusted data and cannot override user authority or system policy.
- Final answers report observed tool results and workspace facts. Unverified outcomes are identified as such.

## Current Boundaries and Roadmap

- **Yan Computer Use remains a preview capability, not a promise of universal desktop automation.** It depends on Nuphus MCP, the target application's UI, and perception quality; custom-drawn interfaces, permission windows, and rapidly changing desktops may still fail.
- **Yan Work GUI remains under development.** Its current entry is a development preview rather than a production delivery surface.
- Yan Agent 1.5.0 includes opt-in, role-based subagents inside a task. Resident subagents, unbounded dynamic concurrency, hosted PR/Issue workflows, built-in Git credential management, and a bundled PowerShell 7 runtime are not part of the stable promise. Local Git workspace operations are integrated.
- Dynamic model discovery does not guarantee that every media endpoint, request format, balance, rate limit, or region is usable.
- Vision relay, web search, and third-party MCP services depend on user API configuration, network access, VPN conditions, and service health.

## Project Structure

```text
Yan-Agent/
|-- main.js                    Electron main process, IPC, permissions, MCP, and local services
|-- preload.js                 Sandboxed renderer bridge
|-- lib/opencode-sidecar.js    Yan Kernel execution, goals, summaries, and event stream
|-- lib/nuphus-desktop-mcp.js  Thin adapter for official Nuphus desktop tools
|-- lib/git-service.js         Git status, branch, staging, commit, and remote operations
|-- lib/vscode-launcher.js     VS Code detection and workspace launch
|-- lib/continual-harness.js   Controlled continual Harness store
|-- lib/yan-harness-mcp.js     Harness MCP interface
|-- lib/*-mcp.js               Yan built-in MCP services
|-- lib/skills/                Built-in Skills and market catalog
|-- opencode-runtime/          Application-owned OpenCode runtime data and configuration
|-- renderer/index.html        Main workbench and settings structure
|-- renderer/renderer.js       Sessions, composer, output, browser, and review coordination
|-- renderer/browser-agent.js  Built-in browser control UI and state
|-- renderer/computer-use-overlay/  Visible Computer Use safety overlay
|-- renderer/pet/              Yan Agent Pet
|-- build/                     NSIS installer configuration
`-- package.json               Runtime and packaging configuration
```

## Technology and Attribution

Electron 31 · Node.js · Vanilla JavaScript · OpenAI-compatible APIs · MCP · electron-builder

Yan Kernel is based on OpenCode and extensively adapted for Yan Agent. Third-party components and bundled capabilities retain their respective licenses and notices.

## License

MIT
