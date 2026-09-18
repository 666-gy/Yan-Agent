'use strict';

// Accept either an API root or a pasted endpoint, without appending a second
// endpoint to it. Preserve gateway prefixes and query parameters.
function endpointInfo(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, '');
    const match = pathname.match(/\/(chat\/completions|chat\/responses?|responses?|messages?)$/i);
    const format = match
      ? (/completions/i.test(match[1]) ? 'openai' : /messages?/i.test(match[1]) ? 'anthropic' : 'responses')
      : '';
    url.pathname = match ? pathname.slice(0, -match[0].length) : pathname;
    return { baseURL: url.toString().replace(/\/$/, ''), format };
  } catch {
    return { baseURL: raw.replace(/\/+$/, ''), format: '' };
  }
}

function isOfficialOpenAI(value) {
  try { return new URL(value).hostname.toLowerCase() === 'api.openai.com'; }
  catch { return false; }
}

module.exports = { endpointInfo, isOfficialOpenAI };
