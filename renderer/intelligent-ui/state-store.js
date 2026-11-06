const STATE_STORAGE='yan.intelligent-ui.state.v1';
const MAX_STATE_BYTES=16*1024;
const MAX_SAVED_PANELS=32;
  function validState(json) {
    if (typeof json !== 'string' || json.length > MAX_STATE_BYTES
      || new TextEncoder().encode(json).length > MAX_STATE_BYTES) return false;
    try { JSON.parse(json); return true; } catch { return false; }
  }
export function savedPanels() {
    try {
      const records = JSON.parse(localStorage.getItem(STATE_STORAGE) || '[]');
      return Array.isArray(records) ? records.filter(record => record && typeof record.key === 'string'
        && /^[a-f0-9]{64}$/.test(record.key) && validState(record.json)).slice(-MAX_SAVED_PANELS) : [];
    } catch { return []; }
  }
export async function panelKey(item) {
    if (!item.id) return null;
    // Include code and revision: an updated program may have a different state schema.
    const identityParts = [item.id, item.revision || 0, item.html];
    if (item.format === 'openui') identityParts.push('openui', item.code);
    if (item.resources?.map || item.resources?.images?.length) identityParts.push(item.resources);
    const identity = JSON.stringify(identityParts);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
export function savePanel(key, json) {
    if (!key || !validState(json)) return false;
    try {
      const records = savedPanels().filter(record => record.key !== key);
      records.push({ key, json });
      localStorage.setItem(STATE_STORAGE, JSON.stringify(records.slice(-MAX_SAVED_PANELS)));
      return true;
    } catch { return false; }
  }
