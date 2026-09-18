'use strict';

// Shared shell allowlists. `lib/opencode-sidecar.js` installs them
// as kernel permission rules (builder run, plan mode, explorer subagents) and
// `lib/subagent/index.js` mirrors the builder set to pre-validate permission
// requests. Every copy must be derived from here — never inline new copies.
const READ_ONLY_SHELL_ALLOW = Object.freeze({
  // `git diff*` already covers `git diff --check`, `--stat`, `--staged`, etc.
  'git status*': 'allow',
  'git diff*': 'allow',
  'git log*': 'allow',
  'git show*': 'allow',
  'rg *': 'allow',
  'Get-Content *': 'allow',
  'Get-ChildItem *': 'allow'
});

const BUILDER_SHELL_RULES = Object.freeze({
  '*': 'deny',
  ...READ_ONLY_SHELL_ALLOW,
  'node --check *': 'allow',
  'node --test*': 'allow',
  'npm test -- *': 'allow',
  'npm run test -- *': 'allow'
});

const EXPLORER_SHELL_RULES = Object.freeze({
  '*': 'deny',
  ...READ_ONLY_SHELL_ALLOW,
  'node --test*': 'allow',
  'npm test*': 'allow'
});

// Mapper: large-repo structure reconnaissance. `node *` runs local analysis
// CLIs (dependency-cruiser, madge, ctags wrappers) — the same execution class
// the test rules already grant. These are usage policies, not a read-only
// sandbox: scripts can write helper artifacts and access the network.
const MAPPER_SHELL_RULES = Object.freeze({
  '*': 'deny',
  ...READ_ONLY_SHELL_ALLOW,
  'git ls-files*': 'allow',
  'git grep*': 'allow',
  'node *': 'allow',
  'npm ls*': 'allow'
});

// Tracer: a deliberate superset of the mapper's reach plus focused dynamic
// tracing — running one targeted test or one-file probe against the code it
// is tracing.
const TRACER_SHELL_RULES = Object.freeze({
  '*': 'deny',
  ...MAPPER_SHELL_RULES,
  'node --test*': 'allow',
  'npm test -- *': 'allow',
  'npm run test -- *': 'allow'
});

// Reverser: an offline protocol-analysis lab. Artifacts are written through
// the edit/write tools into the assigned lab directory; the shell replays
// parsers against local samples and runs hex tooling. Offline analysis and
// lab-only writes are prompt constraints, not OS-enforced isolation.
const REVERSER_SHELL_RULES = Object.freeze({
  '*': 'deny',
  ...READ_ONLY_SHELL_ALLOW,
  'node *': 'allow',
  'python *': 'allow',
  'python3 *': 'allow',
  'certutil *': 'allow',
  'Format-Hex *': 'allow',
  'tshark *': 'allow'
});

// Turns rule patterns into bare prefixes for string-prefix validators
// (`node --check *` -> `node --check `, `npm test -- *` -> `npm test -- `).
function shellAllowPrefixes(rules) {
  return Object.keys(rules)
    .filter(pattern => pattern !== '*' && rules[pattern] === 'allow')
    .map(pattern => pattern.replace(/\*$/, ''));
}

module.exports = {
  READ_ONLY_SHELL_ALLOW,
  BUILDER_SHELL_RULES,
  EXPLORER_SHELL_RULES,
  MAPPER_SHELL_RULES,
  TRACER_SHELL_RULES,
  REVERSER_SHELL_RULES,
  shellAllowPrefixes
};
