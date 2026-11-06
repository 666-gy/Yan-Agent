'use strict';

// Shared read-only command rules for plan mode.
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

module.exports = { READ_ONLY_SHELL_ALLOW };
