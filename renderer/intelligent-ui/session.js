// One persistence queue for the entire OpenUI program. Never owns conversation execution.
export function createPanelSession(api, {onSave, onSummary, delay = 120} = {}) {
  const restored = api.getState();
  const initial = restored?.version === 2 && restored.values && typeof restored.values === 'object' && !Array.isArray(restored.values) ? restored.values : {};
  let timer, current = initial, disposed = false, queued = Promise.resolve();
  const update = values => {
    if (disposed) return;
    current = JSON.parse(JSON.stringify(values));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot = current;
      onSummary?.(Object.entries(snapshot).map(([key,value]) => `${key.replace(/^\$/, '')}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n').slice(0,8000));
      queued = queued.then(async () => {
        if (disposed) return;
        try { const ok = await api.setState({version:2,values:snapshot}); if (!disposed) onSave?.(ok); }
        catch { if (!disposed) onSave?.(false); }
      });
    }, delay);
  };
  return {initial, update, dispose(){disposed=true;clearTimeout(timer);}};
}
