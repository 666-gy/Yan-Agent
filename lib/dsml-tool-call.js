'use strict';

const { ProtocolTextContext, containsDsmlMarkup, findUnquotedMarkup } = require('./protocol-text');

// DeepSeek occasionally serializes an intended Tool Call as DSML text instead
// of returning the provider's native tool_calls field. Keep this parser narrow:
// only complete blocks are recoverable. Callers may validate against a known
// catalog, while the provider adapter deliberately leaves final tool resolution
// to OpenCode's dynamic tool registry. DeepSeek may place a short progress
// sentence beside an intended call, so non-protocol text is preserved.

const MAX_DSML_RESPONSE_BYTES = 8 * 1_048_576;
const MAX_DSML_CALLS = 64;
const DSML_PREFIX_PATTERN = '[|｜]{2}\\s*DSML\\s*[|｜]{2}';
const GENERIC_TOOL_CALL_PATTERN = '<\\/?tool_calls\\b';

const GENERIC_TOOL_ALIASES = Object.freeze({
  read_file: 'read',
  read_file_range: 'read',
  write_file: 'write',
  edit_file: 'edit',
  create_file: 'write',
  list_files: 'glob',
  list_directory: 'glob',
  search_files: 'glob',
  run_command: 'bash',
  execute_command: 'bash',
  shell: 'bash',
  patch: 'apply_patch'
});

function containsDsmlToolCallMarkup(rawText) {
  return containsDsmlMarkup(rawText);
}

function containsGenericToolCallMarkup(rawText) {
  return !!findUnquotedMarkup(rawText, new RegExp(GENERIC_TOOL_CALL_PATTERN, 'iu'));
}

function decodeDsmlText(value) {
  return String(value || '')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&');
}

function readDsmlAttribute(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
  return match ? decodeDsmlText(match[2]).trim() : '';
}

function decodeDsmlParameter(rawValue, isString) {
  const value = decodeDsmlText(rawValue).trim();
  if (String(isString || '').toLowerCase() === 'true') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function recoveryResult(detected, content, calls, error = null) {
  return Object.freeze({
    detected,
    content,
    calls: Object.freeze(calls),
    error
  });
}

function extractProtocolBlocks(source, pattern) {
  const context = new ProtocolTextContext();
  const blocks = [];
  const content = [];
  let offset = 0;
  let match;
  while ((match = findUnquotedMarkup(source.slice(offset), pattern, context))) {
    const prefix = source.slice(offset, offset + match.index);
    content.push(prefix);
    context.write(prefix);
    blocks.push(match);
    offset += match.index + match[0].length;
  }
  content.push(source.slice(offset));
  return { blocks, surroundingContent: content.join('').trim() };
}

function recoverDsmlToolCalls(rawText, authorizedToolIds = null) {
  const source = String(rawText || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_DSML_RESPONSE_BYTES) {
    return recoveryResult(
      false,
      '',
      [],
      `DeepSeek text response exceeded the DSML recovery limit of ${MAX_DSML_RESPONSE_BYTES} bytes.`
    );
  }

  if (!containsDsmlToolCallMarkup(source)) return recoveryResult(false, source, []);

  const blockRe = new RegExp(
    `<${DSML_PREFIX_PATTERN}tool_calls\\s*>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}tool_calls\\s*>`,
    'giu'
  );
  const invokeRe = new RegExp(
    `<${DSML_PREFIX_PATTERN}invoke\\b([^>]*)>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}invoke\\s*>`,
    'giu'
  );
  const parameterRe = new RegExp(
    `<${DSML_PREFIX_PATTERN}parameter\\b([^>]*)>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}parameter\\s*>`,
    'giu'
  );
  const { blocks, surroundingContent } = extractProtocolBlocks(source, blockRe);
  if (!blocks.length) {
    return recoveryResult(true, '', [], 'DeepSeek returned an incomplete DSML Tool Call block.');
  }

  if (containsDsmlToolCallMarkup(surroundingContent)) {
    return recoveryResult(true, '', [], 'DeepSeek returned malformed or incomplete DSML outside the complete Tool Call block.');
  }

  const calls = [];
  for (const block of blocks) {
    invokeRe.lastIndex = 0;
    let invokeMatch;
    while ((invokeMatch = invokeRe.exec(block[1] || '')) !== null) {
      const rawToolId = readDsmlAttribute(invokeMatch[1], 'name');
      if (!rawToolId) return recoveryResult(true, '', [], 'DSML Tool Call is missing its tool name.');

      const args = {};
      parameterRe.lastIndex = 0;
      let parameterMatch;
      while ((parameterMatch = parameterRe.exec(invokeMatch[2] || '')) !== null) {
        const parameterName = readDsmlAttribute(parameterMatch[1], 'name');
        if (!parameterName) {
          return recoveryResult(true, '', [], 'DSML Tool Call contains a parameter without a name.');
        }
        if (Object.hasOwn(args, parameterName)) {
          return recoveryResult(true, '', [], `DSML Tool Call contains duplicate parameter ${parameterName}.`);
        }
        args[parameterName] = decodeDsmlParameter(
          parameterMatch[2],
          readDsmlAttribute(parameterMatch[1], 'string')
        );
      }

      if (authorizedToolIds instanceof Set && !authorizedToolIds.has(rawToolId)) {
        return recoveryResult(
          true,
          '',
          [],
          `DeepSeek requested unavailable Tool ${rawToolId} through DSML.`
        );
      }
      calls.push(Object.freeze({ toolId: rawToolId, args: Object.freeze(args) }));
      if (calls.length > MAX_DSML_CALLS) {
        return recoveryResult(
          true,
          '',
          [],
          `DSML response exceeded the maximum of ${MAX_DSML_CALLS} Tool Calls.`
        );
      }
    }
  }

  if (!calls.length) {
    return recoveryResult(true, '', [], 'DeepSeek returned DSML text without a parseable Tool Call.');
  }
  return recoveryResult(true, surroundingContent, calls);
}

function normalizeGenericToolCall(toolId, args, authorizedToolIds) {
  const requested = String(toolId || '').trim();
  const mapped = GENERIC_TOOL_ALIASES[requested] || requested;
  if (!(authorizedToolIds instanceof Set) || !authorizedToolIds.has(mapped)) {
    return { error: `DeepSeek requested unavailable Tool ${requested} through generic XML.` };
  }

  const normalized = { ...(args || {}) };
  if (['read', 'write', 'edit'].includes(mapped) && normalized.path != null && normalized.filePath == null) {
    normalized.filePath = normalized.path;
    delete normalized.path;
  }
  if (mapped === 'edit') {
    if (normalized.old_text != null && normalized.oldString == null) normalized.oldString = normalized.old_text;
    if (normalized.new_text != null && normalized.newString == null) normalized.newString = normalized.new_text;
    delete normalized.old_text;
    delete normalized.new_text;
  }
  if (mapped === 'apply_patch' && normalized.patch != null && normalized.patchText == null) {
    normalized.patchText = normalized.patch;
    delete normalized.patch;
  }
  if (mapped === 'glob') {
    if (normalized.path == null && normalized.directory != null) normalized.path = normalized.directory;
    if (normalized.pattern == null) normalized.pattern = '**/*';
    delete normalized.directory;
  }
  return { call: Object.freeze({ toolId: mapped, args: Object.freeze(normalized) }) };
}

function recoverGenericToolCalls(rawText, authorizedToolIds = null) {
  const source = String(rawText || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_DSML_RESPONSE_BYTES) {
    return recoveryResult(
      false,
      '',
      [],
      `DeepSeek text response exceeded the generic Tool Call recovery limit of ${MAX_DSML_RESPONSE_BYTES} bytes.`
    );
  }
  if (!containsGenericToolCallMarkup(source)) return recoveryResult(false, source, []);
  if (!(authorizedToolIds instanceof Set) || authorizedToolIds.size === 0) {
    return recoveryResult(true, '', [], 'Generic XML Tool Call recovery requires an active tool catalog.');
  }

  const blockRe = /<tool_calls\s*>([\s\S]*?)<\/tool_calls\s*>/giu;
  const invokeRe = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke\s*>/giu;
  const parameterRe = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter\s*>/giu;
  const { blocks, surroundingContent } = extractProtocolBlocks(source, blockRe);
  if (!blocks.length) {
    return recoveryResult(true, '', [], 'DeepSeek returned an incomplete generic XML Tool Call block.');
  }

  if (containsGenericToolCallMarkup(surroundingContent)) {
    return recoveryResult(true, '', [], 'DeepSeek returned malformed generic XML outside the complete Tool Call block.');
  }

  const calls = [];
  for (const block of blocks) {
    invokeRe.lastIndex = 0;
    let invokeMatch;
    while ((invokeMatch = invokeRe.exec(block[1] || '')) !== null) {
      const rawToolId = readDsmlAttribute(invokeMatch[1], 'name');
      if (!rawToolId) return recoveryResult(true, '', [], 'Generic XML Tool Call is missing its tool name.');
      const args = {};
      parameterRe.lastIndex = 0;
      let parameterMatch;
      while ((parameterMatch = parameterRe.exec(invokeMatch[2] || '')) !== null) {
        const parameterName = readDsmlAttribute(parameterMatch[1], 'name');
        if (!parameterName) {
          return recoveryResult(true, '', [], 'Generic XML Tool Call contains a parameter without a name.');
        }
        if (Object.hasOwn(args, parameterName)) {
          return recoveryResult(true, '', [], `Generic XML Tool Call contains duplicate parameter ${parameterName}.`);
        }
        args[parameterName] = decodeDsmlParameter(
          parameterMatch[2],
          readDsmlAttribute(parameterMatch[1], 'string')
        );
      }
      const normalized = normalizeGenericToolCall(rawToolId, args, authorizedToolIds);
      if (normalized.error) return recoveryResult(true, '', [], normalized.error);
      calls.push(normalized.call);
      if (calls.length > MAX_DSML_CALLS) {
        return recoveryResult(true, '', [], `Generic XML response exceeded the maximum of ${MAX_DSML_CALLS} Tool Calls.`);
      }
    }
  }
  if (!calls.length) {
    return recoveryResult(true, '', [], 'DeepSeek returned generic XML without a parseable Tool Call.');
  }
  return recoveryResult(true, surroundingContent, calls);
}

module.exports = {
  MAX_DSML_RESPONSE_BYTES,
  containsDsmlToolCallMarkup,
  containsGenericToolCallMarkup,
  recoverDsmlToolCalls,
  recoverGenericToolCalls
};
