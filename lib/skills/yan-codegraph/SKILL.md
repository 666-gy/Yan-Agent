---
name: yan-codegraph
description: Use Yan Agent's bundled CodeGraph index to understand an unfamiliar codebase, architecture, dependencies, call chains, symbol relationships, relevant source, and change impact with fewer file reads and searches. Use for structural code questions and before broad exploration of a selected workspace; do not use for exact literal text searches or non-code tasks.
---

# CodeGraph

Use the bundled `codegraph_explore` MCP tool as the first structural read of the current task workspace. Yan Agent initializes the local index and injects the workspace path automatically.

## Workflow

1. Turn the task into one focused structural query naming the feature, symbol, file, flow, or proposed change.
2. Call `codegraph_explore` once before broad `search_files`, `read_file`, or directory walks.
3. Treat returned verbatim source as already read. Use its relationship map and blast-radius section to choose the smallest set of files that need direct inspection or editing.
4. Read a file directly only when exact surrounding text is needed for an edit, the result identifies a missing detail, or CodeGraph reports that the file may be stale.
5. Yan Agent performs an incremental sync before every CodeGraph query. If a staleness notice still names a changed file, read that file directly for the current content instead of repeating the same graph query.

## Query Guidance

- Ask one concrete question, for example: `How does an MCP tool move from discovery to execution, and which files control its permission checks?`
- Include known file or symbol names when available.
- For impact analysis, state the proposed change and ask for callers, dependents, and affected tests in the same query.
- Prefer one complete query over several vague searches.

## Guardrails

- Never search `.yanagent`, `.hermes`, `.codex`, or user-home Agent directories for CodeGraph or Skill files.
- Never run `codegraph install`, `uninstall`, `upgrade`, or telemetry commands. Yan Agent owns the bundled runtime and MCP configuration.
- Do not use CodeGraph for exact string lookup, generated assets, prose-only repositories, or a single already-known file; use the normal file tools instead.
- Do not repeat CodeGraph findings with broad grep/read loops merely to confirm them.
- If the tool is unavailable or indexing fails, report the exact error and continue with the normal code tools when possible.
