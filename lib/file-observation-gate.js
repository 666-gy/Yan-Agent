'use strict';

// ---------------------------------------------------------------------------
// Yan Agent — file observation gate (execution layer)
// ---------------------------------------------------------------------------
// Why this exists: the kernel's edit/write tools compose a patch against
// whatever content the model believes a file holds. If that belief is stale —
// the user edited the file in their editor, a build wrote it, another tool
// in the same run touched it — the write does not fail, it *succeeds*, and
// silently discards the newer content. Nothing in the tool call records it.
//
// The gate answers one question at mutation time: was this exact file observed
// in a state that still holds? The rule is deliberately narrow.
//
//   * Unobserved target  -> allowed. Creating a new file, or writing one the
//     session never opened, is ordinary work; a "read every file before you
//     write it" rule would block legitimate copy-elsewhere workflows and
//     punish the model for work it was asked to do.
//   * Observed and unchanged -> allowed, silently.
//   * Observed and changed   -> DENIED, with the current revision attached so
//     the model can re-read and retry.
//
// Equality-only, order-free: the gate never tries to merge content, never
// rewrites tool arguments, and has no opinion about what the edit *should*
// contain. It only refuses to let a mutation land on a file whose state moved
// since it was read.
//
// Unlike the shell risk gate this one is NOT mode-aware. Full Access means the
// user accepted unconstrained *execution*; it is not consent to lose a file's
// newer contents, and no permission prompt the kernel could show would reveal
// the overwrite after the fact. There is therefore no "off switch" for that
// mode — the switch is the env key below, for tests and for an explicit opt-out.
const FILE_OBSERVATION_GATE_ENV_KEY = 'YAN_FILE_OBSERVATION_GATE';
const GATE_DISABLED_VALUES = new Set(['off', '0', 'false', 'disabled', 'no']);

// Tools that read a file into the model's context, i.e. establish a belief
// about its content. `glob`/`grep`/`list` are deliberately absent: they report
// paths and matches, not contents, so a write composed after them is composed
// from assumption, and treating that as "observed" would make the gate lie.
const OBSERVATION_TOOLS = new Set(['read']);

// Tools that mutate file content. `bash` is absent on purpose: a shell command
// can write anything, and the gate cannot attribute a path to it. Shell changes
// are caught by the next observation instead — the revision simply differs.
const MUTATION_TOOLS = new Set(['write', 'edit', 'apply_patch']);

/**
 * The gate is on unless explicitly turned off; an unset/blank value keeps
 * enforcement so the off switch is never implicit.
 */
function isFileObservationGateEnabled(env = process.env) {
  const value = String(env?.[FILE_OBSERVATION_GATE_ENV_KEY] ?? '').trim().toLowerCase();
  if (!value) return true;
  return !GATE_DISABLED_VALUES.has(value);
}

/**
 * Extract the file paths a tool call targets. Mirrors the argument shapes the
 * rest of the plugin already understands (lib/coding-environment-plugin.mjs
 * `targets`), including the multi-file apply_patch envelope.
 */
function mutationTargets(tool, args = {}) {
  const values = [args.filePath, args.path].filter(value => typeof value === 'string' && value);
  if (tool === 'apply_patch') {
    const patch = String(args.patchText || args.patch || '');
    for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) {
      const value = (match[1] || match[2] || '').trim();
      if (value) values.push(value);
    }
  }
  return values;
}

/**
 * Normalize a path for comparison. The plugin runs on the kernel side, but the
 * same file can be named `C:\a\b.js`, `c:/a/b.js`, or with a `..` segment, and
 * Windows comparison is case-insensitive. Case folding follows the precedent in
 * lib/opencode-sidecar.js (fold on win32 only) so a case-sensitive filesystem
 * is never treated as case-insensitive.
 */
function observationKey(target, platform = process.platform) {
  const resolved = String(target || '').trim();
  if (!resolved) return '';
  const normalized = resolved.replace(/[\\/]+/g, '\\').replace(/\\+$/, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Create the gate for one plugin instance.
 *
 * state: a Map of observationKey -> { revision, at }, supplied by the caller so
 * the lifecycle (bounding, eviction) stays visible next to the session state it
 * belongs beside rather than hidden inside this module.
 *
 * events: optional sink for observability. A deny is worth seeing in a log; a
 * gate that fails silently is indistinguishable from one that never ran.
 */
function createFileObservationGate({ state, events = () => {}, revisionOf, platform = process.platform } = {}) {
  if (!state || typeof state.get !== 'function' || typeof state.set !== 'function') {
    throw new Error('file observation gate requires a Map-like state store');
  }
  if (typeof revisionOf !== 'function') {
    throw new Error('file observation gate requires a revisionOf(file) function');
  }

  /**
   * Record that the model has observed a file. The caller invokes this only
   * after an operation actually returned — see the lifecycle note in the
   * `observe` call sites in lib/coding-environment-plugin.mjs. A baseline
   * written on a failed read or a failed write would describe contents the
   * model never saw, which is worse than having no baseline at all: the gate
   * would then allow a write composed from assumption.
   */
  function observe(file) {
    const key = observationKey(file, platform);
    if (!key) return null;
    const revision = revisionOf(file);
    state.set(key, { revision, file: String(file), at: Date.now() });
    return revision;
  }

  /**
   * Decide whether a mutation may proceed.
   * Returns { action: 'allow' } or { action: 'deny', file, observed, current }.
   * Fail-closed on an unreadable target: a revision we could not compute is not
   * evidence that the file is unchanged.
   */
  function evaluate(files) {
    const list = Array.isArray(files) ? files : [files];
    for (const file of list) {
      const key = observationKey(file, platform);
      if (!key) continue;
      const observed = state.get(key);
      if (!observed) continue;
      const current = revisionOf(file);
      if (current === observed.revision) continue;
      events({ type: 'deny', file: String(file), observed: observed.revision, current });
      return {
        action: 'deny',
        file: String(file),
        observed: observed.revision,
        current,
        observedAt: observed.at
      };
    }
    events({ type: 'allow', count: list.length });
    return { action: 'allow' };
  }

  return { observe, evaluate, observationKey };
}

/**
 * The message shown to the model. It has to say *what* changed and *what to do*
 * — a bare "stale file" rejection leaves the model guessing, and it will retry
 * the same edit. Mirrors the deny-with-guidance idiom the plugin already uses
 * for project rules: the model can revise and retry, its arguments are never
 * silently rewritten.
 */
function staleObservationMessage(result) {
  const state = result.current === 'missing'
    ? 'no longer exists'
    : `changed on disk (revision ${result.current}, observed as ${result.observed})`;
  return `File ${state}: ${result.file}\n`
    + 'The write was not performed, because it was composed against content that is no longer current.\n'
    + 'Re-read the file and re-apply the change against its present contents. '
    + 'If another writer is active in this file, preserve their change instead of overwriting it.';
}

module.exports = {
  FILE_OBSERVATION_GATE_ENV_KEY,
  OBSERVATION_TOOLS,
  MUTATION_TOOLS,
  isFileObservationGateEnabled,
  mutationTargets,
  observationKey,
  createFileObservationGate,
  staleObservationMessage
};
