import risk from './shell-command-risk.js';

// ---------------------------------------------------------------------------
// Yan Agent — shell permission guard (execution layer)
// ---------------------------------------------------------------------------
// Why this exists: the renderer (renderer/renderer.js handleOpenCodePermission)
// is not the only caller that can reach a shell, so a guarantee that lives there
// depends on which caller dispatched the tool. This module is the backstop every
// bash execution passes through.
//
// It is mode-aware on purpose. Full Access configures the kernel to stop asking
// for shell (lib/opencode-sidecar.js permissionForRun resolves `bash: shell` to
// 'allow'), which is precisely the path the renderer never sees. The user picked
// that mode, so the gate defers to it and is disabled for that run
// (lib/coding-environment-plugin.mjs passes `enabled: false` with the reason);
// being stricter than the mode the user chose would be a regression, not a
// safety net. Whenever the gate is enabled it is the single owner of "may this
// command run", and it answers *deny* when it cannot answer safely.
//
// Fail-closed convention (P2):
//   An empty command, a classifier that throws, a classifier that returns a
//   shape we do not recognise, and a risk level we do not know are all DENIED.
//   A judgement that was not made must never degrade into permission. The same
//   rule is why an unrecognised verdict is not treated as "normal": absence of
//   evidence is not evidence of safety.
const SHELL_RISK_GATE_ENV_KEY = 'YAN_SHELL_RISK_GATE';
const GATE_DISABLED_VALUES = new Set(['off', '0', 'false', 'disabled', 'no']);

const DENY_UNCLASSIFIED = 'Shell risk classification returned no usable verdict (fail-closed).';

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The gate is on unless it was explicitly turned off; an unset/blank value
 * keeps enforcement, so the off switch is never implicit.
 */
export function isShellRiskGateEnabled(env = process.env) {
  const value = String(env?.[SHELL_RISK_GATE_ENV_KEY] ?? '').trim().toLowerCase();
  if (!value) return true;
  return !GATE_DISABLED_VALUES.has(value);
}

/**
 * Decide whether one shell command may be executed.
 * Never throws: every failure path resolves to a deny verdict.
 *
 * @param {string} command
 * @param {{ classify?: Function, enabled?: boolean, env?: object }} [options]
 * @returns {{ action: 'allow'|'deny', level: string, category: string,
 *             reason: string, prefix: string|undefined }}
 */
export function evaluateShellRiskGate(command, options = {}) {
  const prefix = risk.deriveShellCommandPrefix(command);
  const enabled = options.enabled === undefined
    ? isShellRiskGateEnabled(options.env)
    : options.enabled !== false;

  if (!enabled) {
    return {
      action: 'allow',
      level: 'skipped',
      category: 'gate-disabled',
      // The caller supplies the reason when it disabled the gate for a
      // deliberate mode (Full Access) rather than for the env switch.
      reason: String(options.disabledReason || '')
        || `${SHELL_RISK_GATE_ENV_KEY} disables the execution-layer shell risk gate.`,
      prefix
    };
  }

  const raw = String(command ?? '').trim();
  if (!raw) {
    return {
      action: 'deny',
      level: 'high',
      category: 'invalid',
      reason: 'Shell command is empty or unparsable.',
      prefix
    };
  }

  const classify = typeof options.classify === 'function'
    ? options.classify
    : risk.classifyDelegatedShellCommand;

  let verdict;
  try {
    verdict = classify(raw);
  } catch (error) {
    return {
      action: 'deny',
      level: 'high',
      category: 'unclassified',
      reason: `${DENY_UNCLASSIFIED} Classifier error: ${describeError(error)}`,
      prefix
    };
  }

  if (!verdict || typeof verdict !== 'object' || typeof verdict.level !== 'string') {
    return {
      action: 'deny',
      level: 'high',
      category: 'unclassified',
      reason: DENY_UNCLASSIFIED,
      prefix
    };
  }

  if (verdict.level === 'high' || verdict.requiresApproval === true) {
    return {
      action: 'deny',
      level: 'high',
      category: String(verdict.category || 'high'),
      reason: String(verdict.reason || 'Command is classified as high risk.'),
      prefix
    };
  }

  if (verdict.level !== 'normal') {
    return {
      action: 'deny',
      level: 'high',
      category: 'unclassified',
      reason: `${DENY_UNCLASSIFIED} Unknown risk level "${verdict.level}".`,
      prefix
    };
  }

  return {
    action: 'allow',
    level: 'normal',
    category: String(verdict.category || 'normal'),
    reason: '',
    prefix
  };
}

export function denyShellCommandMessage(verdict) {
  return `Shell risk gate blocked this command (${verdict.category}): ${verdict.reason} `
    + `Ask the user to run it manually, or set ${SHELL_RISK_GATE_ENV_KEY}=off to disable the gate.`;
}

export { SHELL_RISK_GATE_ENV_KEY };
