 'use strict';
const fs = require('fs');
const path = require('path');
// Pin each chat to its first execution directory, including legacy chats.
function resolveBlankDirectory(dataDir, root, key) {
  const legacy = path.join(dataDir, 'opencode-runtime', 'no-workspace', key);
  const pins = path.join(dataDir, 'opencode-runtime', 'directory-pins');
  const pin = path.join(pins, key + '.json');
  if (fs.existsSync(pin)) return JSON.parse(fs.readFileSync(pin, 'utf8')).directory;
  const directory = fs.existsSync(legacy) ? legacy : path.join(root && path.isAbsolute(root) ? root : path.dirname(legacy), key);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(pins, { recursive: true });
  fs.writeFileSync(pin, JSON.stringify({ directory }));
  return directory;
}
module.exports = { resolveBlankDirectory };
