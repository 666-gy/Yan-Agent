'use strict';

const fs = require('fs');
const path = require('path');

function installation(executable) {
  if (!path.isAbsolute(executable || '') || path.basename(executable).toLowerCase() !== 'reasonix studio.exe') throw new Error('请配置 Reasonix Studio.exe 的绝对路径');
  const resources = path.join(path.dirname(executable), 'resources');
  const host = path.join(resources, 'bin', 'reasonix-studio-host.exe');
  if (![executable, host, path.join(resources, 'app.asar')].every(file => fs.existsSync(file))) throw new Error('Reasonix Studio 安装不完整');
  return { host, page: path.join(resources, 'frontend-next', 'dist') };
}

function connectionFile(dataDir = path.join(process.env.APPDATA || '', 'yan-agent', 'YanData')) {
  return path.join(dataDir, 'external-agents', 'reasonix-device.json');
}
function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('无效的 Reasonix 配对地址'); }
  const addresses = Object.values(require('os').networkInterfaces()).flat().map(x => x.address);
  if (url.protocol !== 'http:' || url.username || url.password ||
      !['127.0.0.1', '[::1]', ...addresses].includes(url.hostname)) throw new Error('Reasonix 配对地址必须指向本机');
  return url.origin;
}
async function pair(link, { dataDir } = {}) {
  let url;
  try { url = new URL(link.trim()); } catch { throw new Error('无效的 Reasonix 配对链接'); }
  const origin = localOrigin(url.href), code = new URLSearchParams(url.hash.slice(1)).get('pair');
  if (!code || code.length > 1024) throw new Error('配对链接缺少有效的 pair 参数');
  let response;
  try { response = await fetch(origin + '/pair', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'User-Agent': 'Yan Agent' },
    body: JSON.stringify({ code })
  }); } catch { throw new Error('无法连接 RS 的设备共享服务'); }
  if (!response.ok) throw new Error(`Reasonix 配对失败 HTTP ${response.status}；请重新生成配对链接`);
  const token = /(?:^|;\s*)reasonix_device=([A-Za-z0-9_-]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
  if (!token || token.length < 32) throw new Error('Reasonix 未返回有效配对凭证');
  require('./storage').atomic(connectionFile(dataDir), { origin, token });
}
// A paired connection attaches to the desktop-owned Hub. Never launch a host
// or terminate the desktop when the Yan client disconnects.
async function connect(executable, { dataDir } = {}) {
  installation(executable);
  let handshake;
  try { handshake = JSON.parse(fs.readFileSync(connectionFile(dataDir), 'utf8')); }
  catch { throw new Error('请打开 RS 设备共享并通过 --pair 配对桌面'); }
  handshake.origin = localOrigin(handshake.origin);
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(handshake.token || '')) throw new Error('Reasonix 配对记录无效，请重新配对');
  const lifetime = new AbortController();
  const close = () => lifetime.abort();
  async function request(route, body, stream = false) {
    if (!/^\/[a-zA-Z0-9/_-]*$/.test(route)) throw new Error('无效的 Reasonix 路由');
    const response = await fetch(handshake.origin + route, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Cookie: `reasonix_device=${handshake.token}`, Origin: handshake.origin, 'Content-Type': 'application/json', ...(stream ? { Accept: 'text/event-stream' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: stream ? lifetime.signal : AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)])
    });
    if (!response.ok) {
      let code = ''; try { const value = await response.json(); code = /^[\w.-]{1,120}$/.test(value.code || '') ? value.code : ''; } catch {}
      throw new Error(`Reasonix HTTP ${response.status}${code ? ` (${code})` : ''}`);
    }
    if (stream) return response;
    if (response.status === 204 || response.status === 202) return null;
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error('Reasonix 响应超过 8 MiB');
    return text ? JSON.parse(text) : null;
  }
  try { await request('/device'); } catch { close(); throw new Error('RS 桌面共享已关闭或配对已失效，请打开 RS 并重新配对'); }
  return { request, close, async events(base, onEvent) {
    const response = await request(base + '/events', undefined, true);
    const finished = (async () => {
      const decoder = new TextDecoder(); let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 8 * 1024 * 1024) throw new Error('Reasonix 事件超过上限');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
          if (line.startsWith('data:')) onEvent(JSON.parse(line.slice(5).trim()));
        }
      }
    })();
    // The caller owns completion; attach immediately to avoid an unhandled
    // rejection if the stream closes during submit.
    finished.catch(() => {});
    return { finished };
  } };
}

module.exports = { installation, connect, pair, connectionFile };
