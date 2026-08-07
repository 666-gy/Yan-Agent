# OpenCode runtime baseline

Yan Kernel Copy uses the official OpenCode runtime as its only Agent execution authority.

- Upstream: https://github.com/anomalyco/opencode
- Release: `v1.18.11`
- Tag commit: `012c2f57f976489d88bd4598a056b4bdcdd428ee`
- Runtime package: `opencode-ai@1.18.11`
- SDK package: `@opencode-ai/sdk@1.18.11`
- License: MIT (retained in this directory)

The executable and generated SDK are installed from the pinned official npm packages. Yan's Electron frontend connects to an authenticated loopback OpenCode server through `lib/opencode-sidecar.js`; it does not implement or fall back to the deleted Yan V1/V2 Agent loop.

## Yan integration boundaries

- OpenCode data, config, cache, state, logs, and sessions are isolated below Yan's own `YanData/opencode-runtime` directory through XDG path variables.
- OpenCode's perceived home directory is pinned to `YanData/opencode-runtime/home` with the `OPENCODE_TEST_HOME` hook available in the pinned `v1.18.11` source. This prevents global `.agents`, `.claude`, and `.opencode` content from entering Yan's runtime while leaving the real shell environment unchanged.
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=true` and `OPENCODE_DISABLE_PROJECT_CONFIG=true` disable external Agent Skill discovery and workspace OpenCode configuration. Yan supplies only its bundled `lib/skills` and `YanData/skills` roots explicitly.
- Yan bundles the official `skills@1.5.21` CLI and exposes it only through the built-in `yan_skills` MCP. Search and installation run inside an isolated staging project below `YanData/SkillStore`; complete validated packages are then atomically placed in `YanData/skills`. Blank never receives general file-write or shell permission for Skill management.
- Blank Skill invocation is available through OpenCode's native Skill tool and the `yan_skills.read_skill` fallback. Deletion is limited to direct children of `YanData/skills` and moves removed packages into Yan quarantine instead of touching any external Agent directory.
- Every run receives a compact catalog of Yan-installed Skills and enabled MCP servers. The catalog guides capability selection; the native Skill tool, Yan Skills MCP result, and live MCP tool schemas remain the authoritative execution instructions.
- `yan_browser` is a built-in MCP backed by an authenticated loopback bridge to Yan's visible browser WebView. Ordinary browsing, research, local previews, and web verification route there first; Playwright is reserved for isolated scripted testing and Chrome is the final fallback for explicit profile, login, or extension requirements.
- The home-isolation hook is upstream-internal rather than a public compatibility promise. Every OpenCode upgrade must re-audit `packages/core/src/global.ts`, `packages/opencode/src/effect/runtime-flags.ts`, and `packages/opencode/src/skill/index.ts` before changing the pinned version.
- Runtime configuration is supplied through `OPENCODE_CONFIG_CONTENT` when the authenticated sidecar starts.
- Yan does not call OpenCode's per-directory `config.update` endpoint: in this pinned upstream release that endpoint persists its payload into `<workspace>/config.json`, which is not an acceptable place for Yan provider credentials or runtime policy.
- A configuration change restarts the sidecar only when no Agent run is active; an in-flight run is never silently moved onto another provider, model, permission set, or MCP configuration.
