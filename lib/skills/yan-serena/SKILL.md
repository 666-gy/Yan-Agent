---
name: yan-serena
description: Use Yan Agent's bundled Serena MCP for symbol-aware code retrieval, reference analysis, diagnostics, refactoring, and precise edits in the selected workspace. Prefer it for existing structured code and Goal repair work; use native patch tools for tiny literal edits or non-code files.
---

# Serena

Yan Agent binds Serena to the current task workspace before the run starts. Never activate, register, or switch projects yourself.

## Workflow

1. Start with `get_symbols_overview` when the relevant file is known, or `find_symbol` when the symbol is known but its file is not.
2. Use `find_referencing_symbols`, `find_declaration`, or `find_implementations` only when callers, implementations, or change impact affect the requested modification.
3. Before editing, identify the exact target symbol and the smallest affected file set. Do not read or rewrite unrelated files.
4. Use `replace_symbol_body`, `insert_before_symbol`, or `insert_after_symbol` for whole-symbol changes. Use `rename_symbol` only for a requested semantic rename and `safe_delete_symbol` only when deletion is required and references have been checked.
5. Use `get_diagnostics_for_file` when diagnostics are relevant to the requested acceptance criteria. Do not add extra checks or improvements that the user did not request.

## Boundaries

- In Goal mode, treat the stated acceptance criteria and allowed scope as authoritative. Serena improves localization; it does not expand the task.
- Prefer one semantic lookup that answers the concrete question over repeated broad reads.
- Yan intentionally does not expose Serena pattern search, pattern replacement, shell, memory, project-management, or file-management tools.
- Do not perform a whole-file or whole-project rewrite when a symbol edit or native patch can resolve the failure.
- Preserve already passing behavior and unrelated user changes.
- For a tiny exact edit inside a large symbol, use Yan Agent's native patch tool instead of replacing the full symbol body.
- If Serena is unavailable or a language server cannot analyze the file type, report the exact limitation and continue with Yan Agent's native workspace tools when the task allows it.
