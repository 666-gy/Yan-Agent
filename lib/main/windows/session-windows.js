'use strict';
// The same application renderer can be bound to a single child conversation.
// Keep window/run ownership in the host, independent of renderer parameters.
const windows = new Map();
let sessionForRun = () => '';
function bind(id, win) {
  const contentsId = win.webContents.id;
  windows.set(contentsId, { id, win });
  win.once('closed', () => windows.delete(contentsId));
}
function owner(event) {
  const binding = windows.get(event?.sender?.id);
  if (!binding) return '';
  if (event.senderFrame !== event.sender.mainFrame) throw Error('只允许会话窗口主框架');
  return binding.id;
}
function assertSession(event, id) {
  const own = owner(event);
  if (own && own !== id) throw Error('此窗口只能操作所属子会话');
  return own;
}
function assertRun(event, runId) { const own = owner(event); if (own && sessionForRun(runId) !== own) throw Error('运行不属于此子窗口'); }
function windowFor(event, main) {
  const binding = windows.get(event.sender.id);
  if (binding && owner(event)) return binding.win;
  return main && event.sender.id === main.webContents.id && event.senderFrame === main.webContents.mainFrame ? main : null;
}
function sendSession(id, channel, detail) {
  for (const binding of windows.values()) if (binding.id === id && !binding.win.isDestroyed()) binding.win.webContents.send(channel, detail);
}
function windowForRun(runId, main) {
  const id = sessionForRun(runId);
  if (id) for (const binding of windows.values()) {
    if (binding.id === id && !binding.win.isDestroyed()) return binding.win;
  }
  return main && !main.isDestroyed() ? main : null;
}
function ownsWebContents(contents) {
  if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return false;
  for (const binding of windows.values()) {
    if (!binding.win.isDestroyed() && binding.win.webContents === contents) return true;
  }
  return false;
}
module.exports = { bind, owner, assertSession, assertRun, windowFor, windowForRun, ownsWebContents, sendSession,
  broadcast(channel, detail) { for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send(channel, detail); },
  configure(resolve) { sessionForRun = resolve; },
  sendRun(runId, channel, detail) { sendSession(sessionForRun(runId), channel, detail); }
};
