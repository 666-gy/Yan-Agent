'use strict';

// Statement-level backward slice for JS/TS (v1, honest approximation).
// Given a symbol's line range and a variable name, returns every line that
// (transitively) feeds the variable's value: reads of the variable anchor
// assignments, and assignments pull in the lines that define the variables
// they reference. Regex-based and structure-level - good enough to point an
// agent at "which lines actually matter for this value", not compiler truth.

const KEYWORD_START_RE = /^\s*(?:\/\/|\*|\/\*)/;

function stripComment(line) {
  const index = line.indexOf('//');
  return index === -1 ? line : line.slice(0, index);
}

function identifierPattern(name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}

function assignmentOf(line, name) {
  const code = stripComment(line);
  // const/let/var name =, name =, name op=, name++ / ++name, for (... name of/in
  return new RegExp(`\\b(?:const|let|var)\\s+${escaped(name)}\\b|\\b${escaped(name)}\\s*(?:=[^=]|\\+=|-=|\\*=|/=|\\+\\+|--|\\])`).test(code)
    || new RegExp(`\\b(?:const|let|var)\\s+\\{[^}]*\\b${escaped(name)}\\b[^}]*\\}\\s*=`).test(code)
    || new RegExp(`\\b(?:const|let|var)\\s+\\[[^\\]]*\\b${escaped(name)}\\b[^\\]]*\\]\\s*=`).test(code);
}

function referencedNames(line) {
  const code = stripComment(line);
  const names = new Set();
  for (const match of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    names.add(match[0]);
  }
  return names;
}

// Returns { lines: [{ line, text, role }], text, covered } where role is
// 'anchor' (variable read), 'assign' (transitively feeding assignment), or
// 'seed' (the defining line(s) of the sliced variable).
function backwardSlice(lines, startLine, endLine, variableName) {
  const target = String(variableName || '').trim();
  if (!target) return { lines: [], text: '', covered: 0 };
  const readPattern = identifierPattern(target);
  const slice = new Map(); // line number -> role
  const queue = [];

  for (let index = startLine - 1; index < Math.min(endLine, lines.length); index++) {
    const code = stripComment(lines[index]);
    if (!code.trim() || KEYWORD_START_RE.test(code)) continue;
    if (readPattern.test(code)) {
      const role = assignmentOf(lines[index], target) ? 'seed' : 'anchor';
      if (!slice.has(index + 1)) {
        slice.set(index + 1, role);
        queue.push(index + 1);
      } else if (role === 'seed') {
        slice.set(index + 1, 'seed');
      }
    }
  }

  const processed = new Set();
  while (queue.length) {
    const lineNumber = queue.shift();
    if (processed.has(lineNumber)) continue;
    processed.add(lineNumber);
    const line = lines[lineNumber - 1] || '';
    if (!['seed', 'assign'].includes(slice.get(lineNumber))) continue;
    for (const name of referencedNames(line)) {
      if (name === target || /^(?:if|for|while|return|const|let|var|function|new|typeof|await|async|case|throw)$/.test(name)) continue;
      // Walk backward from this use to its nearest preceding definition.
      for (let index = lineNumber - 2; index >= startLine - 1; index--) {
        const code = stripComment(lines[index]);
        if (!code.trim() || KEYWORD_START_RE.test(code)) continue;
        if (!assignmentOf(lines[index], name)) continue;
        if (!slice.has(index + 1)) {
          slice.set(index + 1, 'assign');
          queue.push(index + 1);
        }
        break;
      }
    }
  }

  const ordered = [...slice.entries()].sort((left, right) => left[0] - right[0])
    .map(([lineNumber, role]) => ({ line: lineNumber, role, text: lines[lineNumber - 1] }));
  const width = Math.max(4, String(Math.min(endLine, lines.length)).length);
  const text = ordered.map(entry => `${String(entry.line).padStart(width)} [${entry.role.padEnd(6)}] ${entry.text}`).join('\n');
  return { lines: ordered, text, covered: ordered.length };
}

function escaped(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { backwardSlice, assignmentOf, referencedNames };
