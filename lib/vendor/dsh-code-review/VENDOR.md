# Vendored: dsh-code-review

- Upstream: https://github.com/yangzhe1991/dsh-code-review (`@yangzhe1991/dsh-code-review`)
- Version vendored: 0.1.5
- Upstream commit: `5b1ce04e781efa4841315c49dce8369ab9d89c47` (2026-09-02)
- License: MIT (see `LICENSE`, kept verbatim)
- Files vendored verbatim (no modifications):
  - `src/diff-parse.ts` ← upstream `src/client/diff-parse.ts`
  - `src/diff-highlight.ts` ← upstream `src/client/diff-highlight.ts`
  - `src/diff-view.ts` ← upstream `src/client/diff-view.ts`（审阅页 UI 的唯一来源）
  - `src/index.tsx` ← upstream `src/client/index.tsx`（不参与构建；保留作主题变量名单与
    上游宿主逻辑的单一事实来源）
- Yan adapter (no UI): `src/yan-bridge.ts` — re-exports the pure pipeline and adds
  pure data-side helpers (`rawDiffFromSummary`, `sanitizeComments`,
  `applyEmbeddingCompat`).
- Build: `node scripts/build-dsh-code-review.cjs` → `renderer/vendor/dsh-code-review/core.js`.

## Runtime compatibility patches

The upstream review page posts inline comments to `window.opener` (popup
semantics). When the page is embedded in Yan's review sidebar iframe,
`window.opener` is `null`, so the host applies two minimal, documented string
patches to the **generated HTML** (not to the vendored sources) before loading
it — `OPENER_COMPAT_PATCHES` in `src/yan-bridge.ts`:

1. `var target = window.opener` → `var target = window.opener || (window.parent !== window ? window.parent : null)`
2. `if (event.source !== window.opener) return` → `if (event.source !== (window.opener || window.parent)) return`

These touch host-message plumbing only; the rendered UI is byte-identical
otherwise. If upstream changes those lines, the patches no-op (comments fall
back to upstream popup semantics) — no crash, no UI change.

## Why file: iframe instead of blob/srcdoc

Yan's renderer CSP (`script-src 'self'`, `frame-src` without `blob:`) blocks
inline scripts in srcdoc/blob documents. The generated page relies on inline
scripts for copy-to-clipboard and inline comments, so the host persists it to a
rotating temp file (`dsh-review:write-html`) and loads it as a `file:` document
(allowed by `frame-src file:`; a distinct document does not inherit the parent
CSP).
