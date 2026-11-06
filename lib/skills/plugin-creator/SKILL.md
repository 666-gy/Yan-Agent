---
name: plugin-creator
description: Create native Yan plugin packages containing skills, resources, scripts and optional MCP tools; validate and export without installation.
---

# Yan Plugin Creator

Create native Yan plugin packages when the user asks to create a plugin. Do not create a custom Agent or merely install a third-party plugin.

## Workflow

Clarify only missing requirements. Choose skills/resources for reusable workflows, scripts for helpers, and an MCP server only when actual callable tools are needed. Use current file tools to author a dedicated subdirectory of the task workspace. Never edit YanData/plugins or the application catalog.

The package root must contain yan-plugin.json. Only Yan schemaVersion 1 is supported. Codex/Claude manifests are not proof of compatibility: do not silently convert or claim their hooks, UI extensions, or Agent definitions work in Yan.

Minimal package:

```json
{
  "schemaVersion": 1,
  "id": "my-plugin",
  "version": "1.0.0",
  "name": "My Plugin",
  "description": "Describe the capability and when to use it",
  "instructions": "instructions.md",
  "skills": [{"id":"example","name":"Example","description":"Use this workflow for ...","path":"skills/example/SKILL.md"}]
}
```

Write the referenced instructions.md and SKILL.md with the actual requested workflow. Skill documents include YAML name and description. Optional manifest fields: author, license, resources ([{id,name,path}]), configuration ({key:{label,description?,required?,default?}}), environment ([{name,description,required}]), platforms ([win32,darwin,linux]), requiredCommands (program names), mcpServers. Do not invent extra manifest fields; unknown fields fail validation. IDs start with a lowercase letter and contain lowercase letters, digits or hyphens, maximum 48 characters. Versions use major.minor.patch.

All resource paths are package-relative using forward slashes. No symlinks, absolute paths, directory traversal, install hooks or automatic dependency installation. Limit packages to 4000 files and 64 MB. node_modules, .git and __pycache__ are excluded from the package; do not rely on them being shipped.

## Callable tools (optional)

Local MCP declaration: {"id":"service","type":"local","command":"$node","args":["${pluginRoot}/server.cjs"]}. Remote MCP declaration: {"id":"service","type":"remote","url":"https://example.com/mcp"}. Implement the real MCP tools/list and tools/call protocol, not just a script returning JSON. Local servers must be runnable without excluded node_modules (bundle dependencies when necessary). Use $node for Yan's Node runtime. Local processes do not run through a shell; do not use cmd/bat/ps1 entrypoints.

Supported placeholders in args/env/url/headers: ${pluginRoot}, ${workspace}, ${config.KEY}, ${env.KEY}. Declare config/environment keys in the manifest. Never embed credentials. configuration is plain text, environment refers to runtime variables. Package directories are immutable after installation; runtime output belongs in the workspace.

## Deliver

Call yan_skills_create_plugin with source_directory and the current task_id. It validates and copies the authored directory into a separate .yan-plugin directory in the task workspace. A failed call is not a completed package: fix the reported issue and retry. On success link the exact returned path and state whether execution was actually verified.

Creation does not automatically install, register or enable plugins. Installation is available only through the validated Yan Plugin installer. Do not route around validation using scripts, marketplace sources or registry edits. A compatible manifest is not evidence that external dependencies, accounts or tools work. Report declared requirements separately from runtime verification.

For external plugins, never reject solely because of author or host format. Discuss and inspect any format. The Yan Plugin install_plugin tool can import Codex/Claude Skill and MCP declarations with allow_compatibility=true after explaining limitations. An explicit user request to force compatibility already authorizes this attempt; do not ask again. For other formats, adapt an independent copy and validate it. Report concrete blockers and alternatives rather than a blanket refusal. The installation dialog remains official-market-only.
