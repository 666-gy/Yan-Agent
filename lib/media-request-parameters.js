'use strict';

function rejectedOptionalParameter(error, optionalParameters) {
  const status = Number(error?.httpStatus || error?.status);
  if (status !== 400 && status !== 422) return '';
  const message = String(error.message || '');
  const patterns = [
    /["'`]?([a-z][a-z0-9_.]*)["'`]?\s+is\s+(?:a\s+)?(?:forbidden|unknown|unsupported|unrecognized)\s+(?:field|parameter)\b/i,
    /["'`]?([a-z][a-z0-9_.]*)["'`]?\s+is\s+not\s+(?:an?\s+(?:allowed|supported|permitted)\s+(?:request\s+)?(?:field|parameter)|(?:allowed|supported|permitted))\b/i,
    /\b(?:unknown|unsupported|unrecognized|unexpected)\s+(?:field|parameter|argument)\s*:?\s*["'`]?([a-z][a-z0-9_.]*)\b/i,
    /\b(?:field|parameter)\s+["'`]?([a-z][a-z0-9_.]*)["'`]?\s+is\s+(?:not\s+(?:supported|permitted|allowed)|forbidden)\b/i
  ];
  for (const pattern of patterns) {
    const name = message.match(pattern)?.[1];
    if (!name) continue;
    if (optionalParameters.includes(name)) return name;
    const matches = optionalParameters.filter(path => path.endsWith(`.${name}`));
    if (matches.length === 1) return matches[0];
  }
  return '';
}

// A validation rejection has not created media. Retry only by removing the
// exact optional parameter named by the provider; other failures propagate.
async function requestMediaWithOptionalParameters(body, optionalParameters, send) {
  const remaining = optionalParameters.filter(name => {
    const parts = name.split('.');
    const key = parts.pop();
    const parent = parts.reduce((value, part) => value?.[part], body);
    return typeof parent?.has === 'function' ? parent.has(key) : !!parent && Object.hasOwn(parent, key);
  });
  while (true) {
    try { return await send(body); }
    catch (error) {
      const name = rejectedOptionalParameter(error, remaining);
      if (!name) throw error;
      const parts = name.split('.');
      const key = parts.pop();
      const parent = parts.reduce((value, part) => value?.[part], body);
      if (typeof parent?.has === 'function' && typeof parent?.delete === 'function') {
        if (!parent.has(key)) throw error;
        parent.delete(key);
      } else {
        if (!parent || !Object.hasOwn(parent, key)) throw error;
        delete parent[key];
      }
      remaining.splice(remaining.indexOf(name), 1);
    }
  }
}

module.exports = { requestMediaWithOptionalParameters };
