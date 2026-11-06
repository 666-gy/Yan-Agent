/* Shared persisted appearance contract for Electron and the settings renderer. */
(function (root, factory) {
  const appearance = factory();
  if (typeof module === 'object' && module.exports) module.exports = appearance;
  else root.YanAppearance = appearance;
})(globalThis, function () {
  const sans = '"Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", system-ui, sans-serif';
  const mono = '"Cascadia Code", Consolas, "SF Mono", Menlo, monospace';
  const serif = '"Yan Reading Serif", serif';
  const aliases = { inter: 'Inter', geist: 'Geist', 'sf-pro': 'SF Pro Text', segoe: 'Segoe UI', 'source-serif': 'Source Serif 4', cascadia: 'Cascadia Code', jetbrains: 'JetBrains Mono', fira: 'Fira Code', 'source-code': 'Source Code Pro', 'sf-mono': 'SF Mono' };
  const weights = { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 };
  function normalize(value) {
    const v = value && typeof value === 'object' ? value : {};
    const pick = (key, choices, fallback) => choices.includes(v[key]) ? v[key] : fallback;
    const number = (key, fallback, min, max) => v[key] == null || v[key] === '' || !Number.isFinite(Number(v[key])) ? fallback : Math.max(min, Math.min(max, Math.round(Number(v[key]))));
    const font = (key, special) => {
      const name = aliases[v[key]] ? `local:${aliases[v[key]]}` : v[key];
      return special.includes(name) || (typeof name === 'string' && /^local:[^\x00-\x1f\x7f]{1,128}$/.test(name)) ? name : 'system';
    };
    return {
      uiFont: font('uiFont', ['system']), contentFont: font('contentFont', ['system', 'same-ui', 'serif', 'sans']), codeFont: font('codeFont', ['system']),
      uiWeight: pick('uiWeight', Object.keys(weights), 'regular'), contentWeight: pick('contentWeight', Object.keys(weights), 'regular'), codeWeight: pick('codeWeight', Object.keys(weights), 'regular'),
      // The removed control must not leave a hidden, persisted animation override.
      reduceMotion: 'off',
      uiScale: number('uiScale', 14, 12, 20), codeScale: number('codeScale', 12, 10, 24), contrast: number('contrast', 100, 50, 100),
      accent: /^#[\da-f]{6}$/i.test(v.accent) ? v.accent.toLowerCase() : '#0084ff'
    };
  }
  function family(value, fallback) {
    if (!value.startsWith('local:')) return fallback;
    const name = value.slice(6);
    // Modern Microsoft YaHei is the UI variant. Upgrade a legacy YaHei choice
    // so the interface never falls back to the older family.
    if (/^(Microsoft YaHei|微软雅黑)$/i.test(name)) {
      return fallback.includes('"Microsoft YaHei UI"') ? fallback : `"Microsoft YaHei UI", "Microsoft YaHei", ${fallback}`;
    }
    const escaped = name.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `"${escaped}", ${fallback}`;
  }
  return { sans, mono, serif, weights, normalize, family };
});
