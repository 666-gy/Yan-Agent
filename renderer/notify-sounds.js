/* dsh-plugin-notify-sounds compatible presets (nine synthesized sounds + custom). */
(() => {
  const SOUND_IDS = ['bell', 'chime', 'ding', 'drop', 'pulse', 'arc', 'coin', 'success', 'knock', 'custom', 'none'];
  const SOUND_LABELS = { bell: '双音铃', chime: '风铃', ding: '叮', drop: '下落', pulse: '脉冲', arc: '上扬', coin: '硬币', success: '成功', knock: '敲门', custom: '自定义', none: '静音' };
  const PRESETS = {
    bell: [{ f: 987.77, a: 0, d: .55, g: 1 }, { f: 1975.53, a: 0, d: .28, g: .24 }, { f: 1318.51, a: .19, d: .65, g: .9 }, { f: 2637.02, a: .19, d: .3, g: .18 }],
    chime: [{ f: 659.25, a: 0, d: .42, g: .85 }, { f: 830.61, a: .13, d: .46, g: .9 }, { f: 987.77, a: .26, d: .62, g: 1 }],
    ding: [{ f: 830.61, a: 0, d: .62, g: 1 }, { f: 1661.22, a: 0, d: .34, g: .26 }],
    drop: [{ f: 1046.5, a: 0, d: .34, g: .95, to: 755 }, { f: 783.99, a: .17, d: .5, g: .8 }],
    pulse: [{ f: 523.25, a: 0, d: .16, g: .8, t: 'triangle' }, { f: 523.25, a: .22, d: .22, g: .8, t: 'triangle' }],
    arc: [{ f: 523.25, a: 0, d: .28, g: .65 }, { f: 659.25, a: .1, d: .3, g: .78 }, { f: 783.99, a: .2, d: .34, g: .9 }, { f: 1046.5, a: .3, d: .55, g: 1 }],
    coin: [{ f: 987.77, a: 0, d: .09, g: .42, t: 'square' }, { f: 1318.51, a: .085, d: .4, g: .42, t: 'square' }],
    success: [{ f: 587.33, a: 0, d: .1, g: .7, t: 'triangle' }, { f: 739.99, a: .08, d: .1, g: .75, t: 'triangle' }, { f: 880, a: .16, d: .42, g: .85, t: 'triangle' }],
    knock: [{ f: 172, a: 0, d: .11, g: .95, to: 148 }, { f: 172, a: .21, d: .13, g: .9, to: 148 }]
  };
  let context; let customSource = ''; let customBuffer;
  function engine() { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; return context || (context = new C()); }
  function bytes(base64) { try { const raw = atob(base64); const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out.buffer; } catch { return null; } }
  async function setCustom(file) {
    if (!file || file.size > 512 * 1024) throw new Error('自定义提示音不能超过 512 KB');
    const buffer = await file.arrayBuffer(); const e = engine();
    if (!e) throw new Error('当前环境不支持音频播放');
    customBuffer = await e.decodeAudioData(buffer.slice(0)); customSource = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });
    return { customSound: customSource, customSoundName: file.name };
  }
  function play(id, volume = 60, base64 = customSource) {
    if (!id || id === 'none') return;
    const e = engine(); if (!e) return;
    const run = () => {
      const loud = Math.max(0, Math.min(100, Number(volume) || 60)) / 100;
      if (id === 'custom') {
        if (!customBuffer && base64) { const raw = bytes(base64); if (raw) Promise.resolve(e.decodeAudioData(raw)).then(b => { customBuffer = b; customSource = base64; play(id, volume, base64); }).catch(() => {}); return; }
        if (!customBuffer) return; const source = e.createBufferSource(); const gain = e.createGain(); source.buffer = customBuffer; gain.gain.value = loud * .6; source.connect(gain); gain.connect(e.destination); source.start(); return;
      }
      const notes = PRESETS[id]; if (!notes || !loud) return; const master = e.createGain(); master.gain.value = loud * .6; master.connect(e.destination); const start = e.currentTime + .02;
      for (const n of notes) { const osc = e.createOscillator(); const gain = e.createGain(); const at = start + n.a; osc.type = n.t || 'sine'; osc.frequency.setValueAtTime(n.f, at); if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, at + n.d * .85); gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, n.g * .25), at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + n.d); osc.connect(gain); gain.connect(master); osc.start(at); osc.stop(at + n.d + .05); }
      setTimeout(() => { try { master.disconnect(); } catch {} }, 1000);
    };
    if (e.state === 'running') run(); else Promise.resolve(e.resume()).then(() => { if (e.state === 'running') run(); }).catch(() => {});
  }
  window.YanNotifySounds = { SOUND_IDS, SOUND_LABELS, play, setCustom };
})();
