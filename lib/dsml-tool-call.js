'use strict';

// DeepSeek occasionally serializes an intended Tool Call as DSML text instead
// of returning the provider's native tool_calls field. Keep this parser narrow:
// only complete blocks are recoverable. Callers may validate against a known
// catalog, while the provider adapter deliberately leaves final tool resolution
// to OpenCode's dynamic tool registry. DeepSeek may place a short progress
// sentence beside an intended call, so non-protocol text is preserved.

const MAX_DSML_RESPONSE_BYTES = 8 * 1_048_576;
const MAX_DSML_CALLS = 64;
const DSML_PREFIX_PATTERN = '[|｜]{2}\\s*DSML\\s*[|｜]{2}';

function containsDsmlToolCallMarkup(rawText) {
  return new RegExp(`<\\/?${DSML_PREFIX_PATTERN}`, 'iu')
    .test(String(rawText || ''));
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

  const markerRe = new RegExp(`<\\/?${DSML_PREFIX_PATTERN}`, 'iu');
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
  const blocks = [...source.matchAll(blockRe)];
  if (!blocks.length) {
    return recoveryResult(true, '', [], 'DeepSeek returned an incomplete DSML Tool Call block.');
  }

  const surroundingContent = source.replace(blockRe, '').trim();
  if (markerRe.test(surroundingContent)) {
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

module.exports = {
  MAX_DSML_RESPONSE_BYTES,
  containsDsmlToolCallMarkup,
  recoverDsmlToolCalls
};
