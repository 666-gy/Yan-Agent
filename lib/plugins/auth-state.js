'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function accountKey(id, server) { return crypto.createHash('sha256').update(`${id}\0${server.id}\0${server.url}`).digest('hex'); }
function accountStatus(dataDir, id, server) {
  try {
    const status = JSON.parse(fs.readFileSync(path.join(dataDir, 'plugins', 'account-status.json'), 'utf8'))[accountKey(id, server)];
    if (status?.state === 'connecting' && Date.now() - status.updatedAt > 10 * 60 * 1000) return { state: 'needs-auth', message: '授权已超时，请重新连接账号。' };
    return status || { state: 'needs-auth', message: '请在系统浏览器中连接账号。' };
  } catch { return { state: 'needs-auth', message: '请在系统浏览器中连接账号。' }; }
}
module.exports = { accountKey, accountStatus };
