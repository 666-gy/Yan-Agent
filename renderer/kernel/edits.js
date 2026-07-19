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
      return { error: `edit ${i + 1}: old_string is empty.` };
    }

    const first = updated.indexOf(oldStr);
    if (first < 0) {
      return {
        error: `edit ${i + 1}: old_string not found. Read the file again and copy the exact text, including whitespace and indentation.`,
        applied: stats.length
      };
    }
    if (updated.indexOf(oldStr, first + 1) >= 0) {
      return {
        error: `edit ${i + 1}: old_string matches multiple locations. Include more surrounding lines to make it unique.`,
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

async function verifyTextFile(path, expectedContent) {
  const check = await api().readFile(path);
  if (check.error) return { ok: false, error: check.error };
  if (check.isBinary) return { ok: false, error: 'file became binary after write' };
  return {
    ok: check.content === expectedContent,
    size: check.size,
    error: check.content === expectedContent ? null : 'read-back content differs from expected content'
  };
}

async function editTextFile(tool, args, runCtx) {
  const path = await K.resolveWorkspacePath(args.path, runCtx);
  const edits = normalizeEdits(args);
  if (!path) return K.toolError(tool, 'path is required.');
  if (!edits.length) return K.toolError(tool, 'at least one edit is required.');
  if (runCtx && K.requireReadBeforeEdit) {
    const policy = K.requireReadBeforeEdit(runCtx, path);
    if (!policy.ok) return K.toolError(tool, policy.error, { path, policy: 'read_before_edit' });
  }

  const res = await api().readFile(path);
  if (res.error) return K.toolError(tool, res.error, { path });
  if (res.isBinary) return K.toolError(tool, 'cannot edit a binary file.', { path, size: res.size });

  const content = res.content ?? '';
  if (runCtx?.sessionId && runCtx?.runId && api().yanagentRecordChange) {
    try {
      const rec = await api().yanagentRecordChange({
        sessionId: runCtx.sessionId,
        runId: runCtx.runId,
        filePath: path,
        before: content,
        op: tool
      });
      if (rec?.ok && !rec.deduped) runCtx.fileChangeCount = (runCtx.fileChangeCount || 0) + 1;
    } catch {}
  }

  const applied = applyExactEdits(content, edits);
  if (applied.error) {
    return K.toolError(tool, applied.error, { path, applied: applied.applied || 0 });
  }

  const w = await api().writeFile(path, applied.updated);
  if (w.error) return K.toolError(tool, w.error, { path });

  const verification = await verifyTextFile(path, applied.updated);
  const removed = applied.stats.reduce((n, s) => n + s.removedChars, 0);
  const added = applied.stats.reduce((n, s) => n + s.addedChars, 0);
  const output = verification.ok
    ? `Applied ${applied.stats.length} edit(s) to ${path}. -${removed} +${added} chars, now ${w.size} bytes. Read-back verified.`
    : `Wrote ${path} but read-back verification failed.`;
  return K.toolResult(verification.ok, tool, {
    output,
    error: verification.ok ? null : verification.error,
    meta: { path, edits: applied.stats, size: w.size, verification }
  });
}

  K.normalizeEdits = normalizeEdits;
  K.applyExactEdits = applyExactEdits;
  K.verifyTextFile = verifyTextFile;
  K.editTextFile = editTextFile;

})(window.YanKernel);
