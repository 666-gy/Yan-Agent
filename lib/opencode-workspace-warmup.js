'use strict';

const path = require('node:path');
const warmups = new WeakMap();

// OpenCode 1.18.11 caches interrupted InstanceState initialization. Keep both
// lazy registries outside session cancellation: tool.ids does NOT initialize
// MCP connections. A caller may stop waiting, but must not abort these requests.
function warmOpenCodeWorkspace(client, directory) {
  if (!client) return Promise.resolve();
  let directories = warmups.get(client);
  if (!directories) {
    directories = new Map();
    warmups.set(client, directories);
  }
  const key = path.resolve(directory);
  if (!directories.has(key)) {
    const warming = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        client.tool?.ids?.({ directory: key }),
        client.mcp?.status?.({ directory: key })
      ]);
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        if (result.value?.error) throw new Error(`OpenCode workspace warmup failed: ${JSON.stringify(result.value.error)}`);
      }
    }).catch(error => {
      directories.delete(key);
      throw error;
    });
    directories.set(key, warming);
  }
  return directories.get(key);
}

module.exports = { warmOpenCodeWorkspace };
