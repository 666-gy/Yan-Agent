<div align="center">

# Yan Agent

### Build with agents, from the first idea to the final review

**An open-source AI workspace that reads, edits, executes, and verifies.**

[中文](README.md) · [English](README.en.md)

[Download for Windows](https://github.com/ViaTumLab/Yan-Agent/releases/download/v1.7.0/Yan.Agent.Setup.v1.7.0.exe) · [Baidu mirror · code: code](https://pan.baidu.com/s/1KZIFg29V7Ks89pvEWiY4mw?pwd=code) · [Releases](https://github.com/ViaTumLab/Yan-Agent/releases) · [Issues](https://github.com/ViaTumLab/Yan-Agent/issues)

**v1.7.0 · Windows x64 · MIT License**

</div>

![Yan Agent desktop workspace](.github/readme/desktop.png)

Yan Agent is an open-source AI agent for Windows. Give it a goal, a project, and access to your preferred model service. It reads files, investigates problems, edits code, runs commands, and uses browser, testing, and desktop tools to check its work in your actual workspace.

**Projects, conversations, subagents, the browser, file changes, and tool execution revolve around the same task.** Follow progress, add instructions, inspect deliverables, and focus on the decisions that need you.

## What can you work on with Yan?

| Your goal | How Yan approaches it |
| --- | --- |
| Fix a difficult bug | Read the project and logs, trace execution, implement a fix, and run relevant tests. |
| Add a feature | Understand conventions, split frontend and backend work, edit code, and check integration. |
| Turn a design into a page | Implement the design and inspect interactions and screen sizes in the browser. |
| Review code changes | Read diffs and context, identify specific issues, answer questions, and iterate on feedback. |
| Work in a desktop application | Operate Windows applications within granted permissions and use snapshots for context. |
| Continue a long task | Inspect progress, adjust the plan, add context, and resume execution. |

Combine these workflows in one task: change code, launch a preview, check the page, and organize the resulting files. Available tools depend on enabled plugins, model capabilities, and permissions.

## Engineering work, grounded in your project

From elusive bugs and changes spanning multiple modules to new features, Yan works with the actual project. The workspace supplies files and context, the terminal runs commands and tests, and the review panel makes changes visible.

- **Understand:** Locate files and symbols, map relationships, and trace implementation paths.
- **Implement:** Edit files, run development commands, and respond to execution feedback.
- **Verify:** Use tests, browser interactions, and screenshots to check the outcome.
- **Stay involved:** Add guidance while a task runs or queue a follow-up message.

> Fix the issue where refreshing the page signs the user out. Trace frontend session restoration and backend authentication first. Keep the existing UI. Verify login, refresh, logout, and incorrect-password handling, then explain which files changed.

## Multiple subagents, one shared goal

Split complex work across roles: one agent explores code, another implements changes, and another reviews the outcome. The main agent organizes work, combines evidence, and handles integration checks. Inspect progress and outputs in the subagent panel.

![Subagent collaboration](.github/readme/agents.png)

| Role | Suitable work |
| --- | --- |
| Explore | Locate files, symbols, and workspace facts. |
| Review | Identify concrete defects and implementation risks. |
| Research | Consult documentation and external sources. |
| Test | Run tests and diagnostics. |
| Build | Implement and verify code within a defined scope. |
| Mapper | Map repository structure, module boundaries, and data flow. |
| Tracer | Investigate deep call chains and algorithm paths. |
| Reverser | Analyze unfamiliar protocols and behavior, then validate results. |

Assign different models to different roles, or let them follow the main model. Independent tasks can use worktrees to isolate working directories and reduce interference between concurrent edits.

> Investigate frontend login and backend sessions in parallel. Have each agent provide evidence. Consolidate the findings, implement the fix, and run integration checks.

## Bring your existing agents into the workflow

Yan connects with the **Codex, Claude, and Reasonix Studio** desktop agents. Use the agent directory to inspect details, detect installed applications, configure paths, dispatch tasks, and collect results.

Delegate a stage to an external agent, follow collaboration in Yan, and use the results to move forward. You retain control over sign-in, workspace trust, and approvals required by the external application.

## Review the result, from files to pull requests

Before committing, understand the scope of the changes, why they were made, and how they were checked.

- Inspect file trees and code diffs.
- Leave review comments and return feedback to the task.
- Organize work with Git branches, commits, and worktrees.
- Work with pull requests and issues, and ask questions about changes.
- Archive managed worktrees while preserving their work, then restore them when needed.

![Code review](.github/readme/review.png)

## Browser and desktop tools for practical verification

### Built-in browser

Open a local preview or online site, sign in, check forms, exercise interactions, and verify wide and narrow layouts. The browser includes tabs, history, downloads, page annotations, and PDF export. Idle background tabs can freeze and resume to reduce resource use.

### Windows application control

Operate applications within the permissions you grant. Manage always-allowed applications, inspect previously controlled applications and their accumulated experience, and download that experience as **Markdown** for reading, backup, or sharing.

### Application snapshots

When a screen is easier to show than describe, capture an external application window with a configured shortcut. Add its screenshot, application information, and your question to the conversation. Snapshot text can also be inspected.

## Connect tools, skills, and services

Yan's extension system includes **plugins, agents, skills, and MCP**. Install and configure extensions so each task has the methods and tools it needs.

![Plugin interface](.github/readme/plugins.png)

- **Plugins:** Install specialized capabilities, read examples, connect accounts, and control individual skill switches.
- **Skills:** Use built-in methods or import skill directories from other agents by linking or copying them.
- **Project rules:** Supply conventions, build commands, and project boundaries. Configure general preferences through custom instructions.
- **MCP:** Connect local or remote services and load tools and context as needed.

Examples include Figma, Canva, Playwright, Remotion, and HyperFrames, covering design, browser automation, and video creation. Services may require their own accounts, runtimes, and permissions.

## Choose the models that fit your work

Yan supports multiple connections and provider adapter paths, including OpenAI, Anthropic, Gemini, DeepSeek, Qwen, GLM, and Kimi. Select models per task, assign models to subagents, and manage context, reasoning, and output settings.

- **Independent task choices:** Different tasks can use different models.
- **Centralized connections:** Configure endpoints, protocols, API keys, and enabled models.
- **Multimodal workflows:** Configure text, image, and video services and work with visual context.
- **Visible usage:** Inspect tokens, caching, and speed to understand cost and performance.

Model availability, tool calling, context limits, and media capabilities depend on the service. Yan Agent is open source; model and third-party services apply their own billing policies.

## A desktop experience for everyday work

View and edit images with zoom, annotations, text, and comments. Voice input and read-aloud offer additional ways to enter and consume content. Rename, pin, archive, reference, and export conversations, and open deliverables through links.

Configure fonts, sizes, themes, wallpapers, sounds, and notifications for the way you work. Manage memory and accumulated experience in settings.

### Step away from the computer and keep track of tasks

The **LAN WebUI** lets you inspect and manage desktop tasks from a phone or another device. Both devices must share a local network, and the computer running Yan must remain powered on, connected, and serving the WebUI.

## Start your first task

1. **Install:** Download the Windows x64 installer above and launch the application.
2. **Connect a model:** Add an endpoint, API key, and protocol, then refresh and enable models.
3. **Choose a workspace:** Open a project directory or a workspace for the current task.
4. **Describe the deliverable:** Explain what to build, what to preserve, and how to verify completion. Add attachments, plugins, or skills as needed.
5. **Follow and steer:** Watch tool activity and subagent progress, handle approvals, and add guidance.
6. **Review:** Inspect file changes, deliverables, and validation before committing or iterating.

Start with a bounded task, such as investigating a specific error and adding regression coverage. Clear scope and acceptance criteria make collaboration more effective.

## For developers

### Run from source

Use Windows x64, Node.js, and npm:

```powershell
git clone https://github.com/ViaTumLab/Yan-Agent.git
cd Yan-Agent
npm ci
npm start
```

Use `npm run dev` for development. Some capabilities require runtime preparation:

| Command | Purpose |
| --- | --- |
| `npm run build:desktop-bridge` | Build desktop bridge components. |
| `npm run build:cua-driver` | Prepare the computer-control runtime. |
| `npm run build:playwright` | Prepare the Playwright runtime. |
| `npm test` | Run project unit tests. |
| `npm run build` | Build the Windows installer and run related packaging checks. |
| `npm run build:release` | Build installer and portable distributions. |

Outputs are written to `dist/`. Build scripts may download components and require corresponding system tools. End-to-end tests may depend on desktop applications, accounts, and model services.

### Code map

| Path | Contents |
| --- | --- |
| `main.js` / `preload.js` | Electron main-process entry and desktop bridging. |
| `renderer/` | Conversation, settings, browser, and review interfaces. |
| `lib/` | Model adapters, task execution, tools, plugins, and data management. |
| `scripts/` | Builds, runtime preparation, and maintenance. |
| `test/` | Unit tests and end-to-end verification. |

## Frequently asked questions

**Do I need a specific model subscription?** Configure the service you prefer. Providers manage their own accounts, quotas, and fees. External agents require their applications and sign-in state.

**Does all data stay local?** Conversations, configuration, workspace state, and experience are managed locally. Model and third-party calls send required content to their respective services. Choose services according to your project's data requirements.

**Can I run it on my phone?** The current installer targets Windows x64. A phone can manage tasks through the LAN WebUI while the computer executes them.

**Can I review a plan before changes begin?** Use planning mode to discuss steps, scope, and validation before implementation.

## Join the project

Use [Issues](https://github.com/ViaTumLab/Yan-Agent/issues) to share feedback, reproducible problems, and feature suggestions. Pull requests improving implementation, tests, and documentation are welcome.

Include the version, reproduction steps, expected and actual behavior, and sanitized logs or screenshots when reporting a problem. Run relevant checks before submitting code, and describe the scope and validation of your changes.

## License and acknowledgments

Yan Agent uses the [MIT License](LICENSE). Thank you to developers contributing to model tooling, desktop applications, browser automation, and the open-source ecosystem. Third-party components, skills, and plugins retain their own licenses; see [third-party notices](lib/THIRD_PARTY_NOTICES.md) and [skill notices](lib/skills/THIRD_PARTY_NOTICES.md).

**Start building with Yan Agent.** [Download v1.7.0](https://github.com/ViaTumLab/Yan-Agent/releases/download/v1.7.0/Yan.Agent.Setup.v1.7.0.exe)
