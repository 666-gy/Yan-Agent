import { createHmac, randomUUID } from 'node:crypto';

// Stable across growing turns and process restarts with the same API key.
// No user content appears in the routing hint. Explicit hints always win.
export function conversationAffinity(secret, namespace = '') {
  const salt = secret || randomUUID();
  return body => {
    const items = body.messages || body.input;
    const first = Array.isArray(items) ? items.find(item => item?.role === 'user') : null;
    if (!first) return '';
    // Only hash namespace and first message to maximize cache reuse across endpoint switches
    return 'yan-' + createHmac('sha256', salt).update(JSON.stringify([namespace, first])).digest('hex').slice(0, 48);
  };
}
