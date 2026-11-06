# Subagent avatar assets

28 light/dark SVG pairs from the installed Codex desktop application's subagent
avatar palette (OpenAI.Codex 26.1027.3384.0), imported on 2026-10-31 for the
requested Codex avatar behavior. Original artwork attribution remains with its
respective owners; this directory does not relicense the artwork.

Numeric filenames preserve palette order. Selection is a stable ID hash in
`renderer/subagent-panel.js`; role, activation, status and title do not determine
the avatar. All resources are local, including SVG data URLs decoded from the
package. Theme variants switch through CSS without changing the selected index.

See `docs/codex-subagent-avatar-research-2026-10-31.md` for implementation evidence.
