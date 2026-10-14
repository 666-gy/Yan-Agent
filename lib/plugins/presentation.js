'use strict';
// Display-only upstream metadata; it never grants runtime permissions.
function presentation(upstream) {
  const value = upstream.interface || {};
  const text = (key, max = 8000) => typeof value[key] === 'string' ? value[key].slice(0, max) : '';
  const link = key => {
    try { const url = new URL(text(key)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  };
  return { shortDescription: text('shortDescription', 500), longDescription: text('longDescription'), developer: text('developerName', 200),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter(item => typeof item === 'string').slice(0, 12) : [],
    website: link('websiteURL'), privacy: link('privacyPolicyURL'), terms: link('termsOfServiceURL') };
}
module.exports = { presentation };
