/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
function normalizeEdits(args) {
  if (Array.isArray(args.edits)) return args.edits;
  if (Array.isArray(args.replacements)) return args.replacements;
  return [{ old_string: args.old_string, new_string: args.new_string }];
}

function applyExactEdits(content, edits) {
  let updated = content;
  const stats = [];

  for (let i = 0; i < edits.length; i++) {
    const oldStr = String(edits[i]?.old_string ?? '');
    const newStr = String(edits[i]?.new_string ?? '');
    if (!oldStr) {
      return { error: `edit ${i + 1}: old_string is empty.`, code: 'EDIT_EMPTY' };
    }

    const first = updated.indexOf(oldStr);
    if (first < 0) {
      return {
        error: `edit ${i + 1}: old_string not found. Read the file again and copy the exact text, including whitespace and indentation.`,
        code: 'EDIT_NOT_FOUND',
        applied: stats.length
      };
    }
    if (updated.indexOf(oldStr, first + 1) >= 0) {
      return {
        error: `edit ${i + 1}: old_string matches multiple locations. Include more surrounding lines to make it unique.`,
        code: 'EDIT_NOT_UNIQUE',
        applied: stats.length
      };
    }

    updated = updated.slice(0, first) + newStr + updated.slice(first + oldStr.length);
    stats.push({
      index: i + 1,
      offset: first,
      removedChars: oldStr.length,
      addedChars: newStr.length
    });
  }

  return { updated, stats };
}

/**
 * Line-trimmed fallback match: find the unique run of lines in `content` whose
 * right-trimmed (and, second pass, fully trimmed) text equals the corresponding
 * lines of `oldStr`. Returns { start, end } character offsets, or an error code.
 * Never matches on trimmed-empty patterns and never fuzzy-matches content —
 * only leading/trailing whitespace per line is forgiven.
 */
function findLineTrimmedMatch(content, oldStr, trimMode) {
  const trim = trimMode === 'full'
    ? (line) => line.trim()
    : (line) => line.replace(/\s+$/, '');
  const patternLines = oldStr.split('\n').map(trim);
  // Refuse degenerate patterns (all-blank) — too easy to match the wrong spot.
  if (!patternLines.some(l => l.length > 0)) return { code: 'EDIT_REPAIR_DEGENERATE' };

  const lines = content.split('\n');
  const lineStarts = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = offset;
    offset += lines[i].length + 1;
  }

  let matchIndex = -1;
  for (let i = 0; i + patternLines.length <= lines.length; i++) {
    let matches = true;
    for (let j = 0; j < patternLines.length; j++) {
      if (trim(lines[i + j]) !== patternLines[j]) { matches = false; break; }
    }
    if (matches) {
      if (matchIndex >= 0) return { code: 'EDIT_NOT_UNIQUE' };
      matchIndex = i;
    }
  }
  if (matchIndex < 0) return { code: 'EDIT_NOT_FOUND' };

  const lastLine = matchIndex + patternLines.length - 1;
  return {
    start: lineStarts[matchIndex],
    end: lineStarts[lastLine] + lines[lastLine].length
  };
}

/**
 * Reindent new_string to match the actual indentation found at the match site.
 * If every matched line shares a common indentation delta versus the pattern,
 * apply that delta to new_string's lines; otherwise return new_string as-is.
 */
function reindentReplacement(matchedText, oldStr, newStr) {
  const matchedLines = matchedText.split('\n');
  const oldLines = oldStr.split('\n');
  if (matchedLines.length !== oldLines.length) return newStr;
  const indentOf = (line) => (line.match(/^[ \t]*/) || [''])[0];
  let delta = null;
  for (let i = 0; i < oldLines.length; i++) {
    if (!oldLines[i].trim()) continue; // blank lines carry no indent signal
    const mIndent = indentOf(matchedLines[i]);
    const oIndent = indentOf(oldLines[i]);
    if (mIndent === oIndent) { if (delta === null) delta = ''; continue; }
    if (mIndent.endsWith(oIndent)) {
      const d = mIndent.slice(0, mIndent.length - oIndent.length);
      if (delta === null || delta === '') delta = d;
      else if (delta !== d) return newStr; // inconsistent — don't guess
    } else {
      return newStr;
    }
  }
  if (!delta) return newStr;
  return newStr.split('\n').map(l => (l.trim() ? delta + l : l)).join('\n');
}

/**
 * Whitespace-tolerant repair, staged from safest to most forgiving:
 *  1. CRLF normalization (exact match after \r\n → \n)
 *  2. Trailing-whitespace-insensitive line match
 *  3. Fully line-trimmed match with indentation-preserving reindent
 * Content is never fuzzy-matched; only whitespace is forgiven, and the match
 * must be unique in the file.
 */
function tryWhitespaceRepair(content, edits) {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedEdits = edits.map(e => ({
    old_string: String(e?.old_string ?? '').replace(/\r\n/g, '\n'),
    new_string: String(e?.new_string ?? '').replace(/\r\n/g, '\n')
  }));

  const restoreEol = (applied, mode) => {
    if (applied.error) return applied;
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfOnlyCount = (content.replace(/\r\n/g, '').match(/\n/g) || []).length;
    if (crlfCount > lfOnlyCount) {
      applied.updated = applied.updated.replace(/\n/g, '\r\n');
    }
    applied.repaired = mode;
    return applied;
  };

  // Stage 1: exact after CRLF normalization
  let applied = applyExactEdits(normalizedContent, normalizedEdits);
  if (!applied.error) return restoreEol(applied, 'whitespace_crlf');

  // Stages 2-3: per-edit line-trimmed matching, applied sequentially
  for (const trimMode of ['trailing', 'full']) {
    let updated = normalizedContent;
    const stats = [];
    let failed = null;
    for (let i = 0; i < normalizedEdits.length; i++) {
      const oldStr = normalizedEdits[i].old_string;
      const newStr = normalizedEdits[i].new_string;
      if (!oldStr) { failed = { error: `edit ${i + 1}: old_string is empty.`, code: 'EDIT_EMPTY' }; break; }
      // Try exact first for this edit (earlier edits may have already fixed context)
      const first = updated.indexOf(oldStr);
      if (first >= 0 && updated.indexOf(oldStr, first + 1) < 0) {
        updated = updated.slice(0, first) + newStr + updated.slice(first + oldStr.length);
        stats.push({ index: i + 1, offset: first, removedChars: oldStr.length, addedChars: newStr.length });
        continue;
      }
      const match = findLineTrimmedMatch(updated, oldStr, trimMode);
      if (match.code) { failed = { error: `edit ${i + 1}: old_string not found (line-trimmed match: ${match.code}).`, code: match.code === 'EDIT_NOT_UNIQUE' ? 'EDIT_NOT_UNIQUE' : 'EDIT_NOT_FOUND', applied: stats.length }; break; }
      const matchedText = updated.slice(match.start, match.end);
      const replacement = trimMode === 'full' ? reindentReplacement(matchedText, oldStr, newStr) : newStr;
      updated = updated.slice(0, match.start) + replacement + updated.slice(match.end);
      stats.push({ index: i + 1, offset: match.start, removedChars: matchedText.length, addedChars: replacement.length });
    }
    if (!failed) {
      return restoreEol({ updated, stats }, trimMode === 'full' ? 'line_trimmed_reindent' : 'trailing_whitespace');
    }
    if (trimMode === 'full') return failed;
  }
  return applied;
}

/**
 * When an edit fails to match, find the file region most similar to the first
 * line of old_string and return a small numbered snippet. Sending the model the
 * actual nearby text is far cheaper than it re-reading the whole file.
 */
function closestMatchSnippet(content, oldStr, contextLines = 6) {
  const firstMeaningful = oldStr.split('\n').map(l => l.trim()).find(l => l.length >= 8)
    || oldStr.split('\n').map(l => l.trim()).find(l => l.length > 0);
  if (!firstMeaningful) return null;
  const lines = content.split('\n');
  let bestIdx = -1;
  // Pass 1: exact trimmed-line hit.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === firstMeaningful) { bestIdx = i; break; }
  }
  // Pass 2: best common-prefix score — catches near-misses where the difference
  // is mid-line (a changed argument, renamed variable, different quote style).
  if (bestIdx < 0) {
    let bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const n = Math.min(t.length, firstMeaningful.length);
      let k = 0;
      while (k < n && t[k] === firstMeaningful[k]) k++;
      if (k > bestScore) { bestScore = k; bestIdx = i; }
    }
    if (bestScore < 8) return null; // too dissimilar to be useful guidance
  }
  if (bestIdx < 0) return null;
  const start = Math.max(0, bestIdx - 2);
  const end = Math.min(lines.length, bestIdx + contextLines);
  const snippet = lines.slice(start, end)
    .map((l, i) => `${start + i + 1}| ${l}`)
    .join('\n');
  return { line: bestIdx + 1, snippet };
}

async function verifyTextFile(path, expectedContent, workspace) {
  const check = await api().readFile(path, workspace);
  if (check.error) return { ok: false, error: check.error, code: check.code };
  if (check.isBinary) return { ok: false, error: 'file became binary after write', code: 'EDIT_VERIFY_BINARY' };
  return {
    ok: check.content === expectedContent,
    size: check.size,
    error: check.content === expectedContent ? null : 'read-back content differs from expected content',
    code: check.content === expectedContent ? 'OK' : 'EDIT_VERIFY_MISMATCH'
  };
}

async function editTextFile(tool, args, runCtx) {
  const pathResolve = K.resolveWorkspacePathSafe
    ? await K.resolveWorkspacePathSafe(args.path, runCtx)
    : { ok: true, path: await K.resolveWorkspacePath(args.path, runCtx) };
  if (!pathResolve.ok) {
    return K.toolError(tool, pathResolve.error, { code: pathResolve.code || 'PATH_ESCAPE', path: args.path });
  }
  const path = pathResolve.path;
  const edits = normalizeEdits(args);
  if (!path) return K.toolError(tool, 'path is required.', { code: 'INVALID_ARGUMENTS' });
  if (!edits.length) return K.toolError(tool, 'at least one edit is required.', { code: 'INVALID_ARGUMENTS' });
  if (runCtx && K.requireReadBeforeEdit) {
    const policy = K.requireReadBeforeEdit(runCtx, path);
    if (!policy.ok) {
      return K.toolError(tool, policy.error, { path, policy: 'read_before_edit', code: policy.code || 'POLICY_READ_BEFORE_EDIT', noRetry: true });
    }
  }

  const ws = (runCtx && K.getRunWorkspace) ? await K.getRunWorkspace(runCtx) : '';
  const res = await api().readFile(path, ws);
  if (res.error) return K.toolError(tool, res.error, { path, code: res.code });
  if (res.isBinary) return K.toolError(tool, 'cannot edit a binary file.', { path, size: res.size, code: 'EDIT_BINARY' });

  const content = res.content ?? '';
  let applied = applyExactEdits(content, edits);
  let repairUsed = null;
  if (applied.error && (applied.code === 'EDIT_NOT_FOUND' || /old_string not found/i.test(applied.error))) {
    const maxRepair = Number(K.MAX_EDIT_REPAIR_ATTEMPTS) || 1;
    if (maxRepair > 0) {
      const repaired = tryWhitespaceRepair(content, edits);
      if (!repaired.error) {
        applied = repaired;
        repairUsed = repaired.repaired || 'whitespace_crlf';
      }
    }
  }

  if (applied.error) {
    let errorText = applied.error;
    if (applied.code !== 'EDIT_NOT_UNIQUE') {
      const failedIndex = Math.min(edits.length - 1, applied.applied || 0);
      const near = closestMatchSnippet(content, String(edits[failedIndex]?.old_string ?? ''));
      if (near) {
        errorText += `\nClosest match near line ${near.line}:\n${near.snippet}\nAdjust old_string to match this actual text exactly.`;
      }
    }
    return K.toolError(tool, errorText, {
      path,
      applied: applied.applied || 0,
      code: applied.code || 'EDIT_FAILED',
      repair_hints: applied.code === 'EDIT_NOT_UNIQUE'
        ? ['Include more surrounding lines in old_string', 'Or split into apply_patch hunks']
        : ['Use the closest-match snippet above to fix old_string', 'Do not re-read the whole file']
    });
  }

  if (runCtx && K.checkWebAutomationWritePolicy) {
    const browserPolicy = K.checkWebAutomationWritePolicy(path, content, applied.updated, runCtx);
    if (!browserPolicy.ok) {
      return K.toolError(tool, browserPolicy.error, {
        path,
        policy: 'builtin_web_preview_only',
        code: browserPolicy.code,
        nonFatal: true,
        noRetry: true
      });
    }
  }

  let recordedChange = false;
  if (runCtx?.sessionId && runCtx?.runId && api().yanagentRecordChange) {
    try {
      const rec = await api().yanagentRecordChange({
        sessionId: runCtx.sessionId,
        runId: runCtx.runId,
        filePath: path,
        before: content,
        op: tool
      });
      recordedChange = !!(rec?.ok && !rec.deduped);
    } catch {}
  }

  const w = await api().writeFile(path, applied.updated, ws);
  if (w.error) return K.toolError(tool, w.error, { path, code: w.code });
  if (recordedChange) runCtx.fileChangeCount = (runCtx.fileChangeCount || 0) + 1;

  const verification = await verifyTextFile(path, applied.updated, ws);
  const removed = applied.stats.reduce((n, s) => n + s.removedChars, 0);
  const added = applied.stats.reduce((n, s) => n + s.addedChars, 0);
  const output = verification.ok
    ? `Applied ${applied.stats.length} edit(s) to ${path}. -${removed} +${added} chars, now ${w.size} bytes. Read-back verified.${repairUsed ? ` (auto-repaired: ${repairUsed})` : ''}`
    : `Wrote ${path} but read-back verification failed.`;
  return K.toolResult(verification.ok, tool, {
    output,
    error: verification.ok ? null : verification.error,
    meta: {
      path,
      edits: applied.stats,
      size: w.size,
      verification,
      code: verification.ok ? 'OK' : (verification.code || 'EDIT_VERIFY_MISMATCH'),
      repaired: repairUsed || undefined
    }
  });
}

  K.normalizeEdits = normalizeEdits;
  K.applyExactEdits = applyExactEdits;
  K.tryWhitespaceRepair = tryWhitespaceRepair;
  K.findLineTrimmedMatch = findLineTrimmedMatch;
  K.closestMatchSnippet = closestMatchSnippet;
  K.reindentReplacement = reindentReplacement;
  K.verifyTextFile = verifyTextFile;
  K.editTextFile = editTextFile;

})(window.YanKernel);
