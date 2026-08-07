---
name: yan-understand-anything
description: Use Yan Agent's local Understand Anything viewer together with the bundled CodeGraph index to orient yourself in an unfamiliar codebase, inspect file and symbol responsibilities, trace dependencies, review change impact, and navigate a large workspace visually. Use for architecture questions, repository onboarding, broad feature planning, and codebase-level impact analysis; do not use for exact text search or small edits in an already-known file.
---

# Understand Anything

Use the local viewer as a read-only visual projection of the current task workspace. The graph is generated from the same incremental CodeGraph index used by `codegraph_explore`; it does not require an API key, network access, or an extra installation.

## Workflow

1. Ask one focused structural question and call `codegraph_explore` first. Include the feature, symbol, file, or proposed change.
2. Use the Understand Anything view to inspect the project overview, directory layers, file nodes, symbol nodes, connections, and source preview.
3. Follow the smallest useful path: file -> containing symbol -> calls/contains/dependencies. Do not open every file just because it appears in the graph.
4. Treat the graph as a navigation and relationship index. Read the exact source file when editing, checking current content, or when the graph reports stale data.
5. After source changes, refresh the Understand Anything view before relying on its graph again. CodeGraph performs incremental synchronization before structural queries.

## Boundaries

- Use ordinary search tools for exact literals, filenames, generated assets, and prose-only work.
- Keep exploration read-only until the task explicitly asks for a change.
- Never look for Skill or MCP files in user-home agent directories or unrelated plugin caches. Yan Agent's installed Skill store and current workspace are the only relevant locations.
- Do not install, upgrade, or modify CodeGraph. Yan Agent owns the bundled runtime and local index.
- If the viewer cannot open, report the concrete local error and continue with CodeGraph and normal file tools when possible.
