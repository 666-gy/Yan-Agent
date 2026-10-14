/* Local kernel usage; data is aggregated outside Electron's main process. */
(() => {
  const page = document.querySelector('#tab-usage');
  let range = 'all', request = 0;
  const number = value => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const full = value => new Intl.NumberFormat('zh-CN').format(value);
  const colors = ['#4b86e5', '#70a0ee', '#a0bff3', '#6b79cd', '#49a6b5', '#c38bba'];
  const color = index => colors[index % colors.length];
  const esc = value => escapeHtml(String(value));
  const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const rangeLabels = { all: '全部', '30d': '30 天', '7d': '7 天' };
  const filters = label => `<div class="usage-filters" role="group" aria-label="${label}时间范围">${['all', '30d', '7d'].map(value => `<button type="button" data-usage-range="${value}" aria-pressed="${value === range}">${rangeLabels[value]}</button>`).join('')}</div>`;
  const header = label => `<header><h2>${label}</h2>${filters(label)}</header>`;

  function heatmap(data) {
    const byDate = new Map(data.days.map(day => [day.date, day]));
    const today = Date.parse(`${data.today}T00:00:00Z`);
    const days = [];
    // End on the current week, Sunday first; future cells remain blank.
    const end = today + (6 - new Date(today).getUTCDay()) * 86400000;
    for (let i = 181; i >= 0; i--) {
      const time = end - i * 86400000, date = new Date(time).toISOString().slice(0, 10);
      days.push({ date, future: time > today, ...(byDate.get(date) || { total: 0, messages: 0 }) });
    }
    const max = Math.max(1, ...days.map(day => day.total));
    return `<div class="usage-heatmap" aria-label="近 26 周每日 Token 用量">${days.map(day => {
      const level = day.total ? Math.max(1, Math.ceil(day.total / max * 4)) : 0;
      const label = `${day.date}：${full(day.total)} Token，${full(day.messages)} 条消息`;
      return `<span class="usage-day level-${level}${day.future ? ' future' : ''}" title="${label}" aria-label="${label}"></span>`;
    }).join('')}</div><div class="usage-chart-caption"><span>近 26 周 · ${esc(data.timeZone)}</span><span>少 <i class="usage-day level-0"></i><i class="usage-day level-1"></i><i class="usage-day level-2"></i><i class="usage-day level-3"></i><i class="usage-day level-4"></i> 多</span></div>`;
  }

  function chart(data) {
    if (!data.days.length || !data.overview.total) return '<div class="usage-empty">该时间段内没有 Token 用量记录。</div>';
    const last = Date.parse(`${data.today}T00:00:00Z`);
    const first = range === 'all' ? Date.parse(`${data.days[0].date}T00:00:00Z`) : last - (parseInt(range, 10) - 1) * 86400000;
    const span = Math.floor((last - first) / 86400000) + 1;
    const step = Math.max(1, Math.ceil(span / 30));
    const buckets = Array.from({ length: Math.ceil(span / step) }, (_, i) => ({
      start: new Date(first + i * step * 86400000).toISOString().slice(0, 10),
      end: new Date(Math.min(last, first + ((i + 1) * step - 1) * 86400000)).toISOString().slice(0, 10), total: 0, models: {}
    }));
    for (const day of data.days) {
      const index = Math.floor((Date.parse(`${day.date}T00:00:00Z`) - first) / 86400000 / step);
      const bucket = buckets[index]; if (!bucket) continue;
      bucket.total += day.total;
      for (const [key, total] of Object.entries(day.models)) bucket.models[key] = (bucket.models[key] || 0) + total;
    }
    const max = Math.max(1, ...buckets.map(bucket => bucket.total));
    const ceiling = Math.ceil(max / 10 ** Math.floor(Math.log10(max))) * 10 ** Math.floor(Math.log10(max));
    return `<div class="usage-chart"><div class="usage-axis">${[1, .75, .5, .25, 0].map(f => `<span>${number(ceiling * f)}</span>`).join('')}</div><div class="usage-bars">${buckets.map((bucket, index) => {
      const label = `${bucket.start}${bucket.end !== bucket.start ? ` – ${bucket.end}` : ''}`;
      const details = data.models.filter(m => bucket.models[m.key]).map(m => `${m.modelId}（${m.providerId}）：${full(bucket.models[m.key])}`).join('\n');
      const showLabel = index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 6)) === 0;
      return `<div class="usage-column"><div class="usage-bar" role="img" aria-label="${esc(`${label}：${full(bucket.total)} Token`)}" title="${esc(`${label}：${full(bucket.total)} Token\n${details}`)}">${data.models.map((model, i) => `<span style="height:${(bucket.models[model.key] || 0) / ceiling * 100}%;background:${color(i)}"></span>`).join('')}</div><span class="usage-date">${showLabel ? dateLabel(bucket.start) : ''}</span></div>`;
    }).join('')}</div></div><p class="usage-chart-caption">${step === 1 ? '每日' : `每 ${step} 天`} Token 用量 · 悬停柱状图查看明细</p>`;
  }

  function render(data) {
    const o = data.overview;
    const hour = o.peakHour === null ? '—' : `${String(o.peakHour).padStart(2, '0')}:00`;
    const metrics = [['会话', full(o.sessions)], ['消息', full(o.messages)], ['总 Token', number(o.total)], ['活跃天数', full(o.activeDays)], ['高峰时段', hour], ['常用模型', o.favoriteModel || '—']];
    page.querySelector('#usagePanels').innerHTML = `<section class="usage-card" aria-label="用量概览">${header('概览')}<div class="usage-metrics">${metrics.map(([label, value]) => `<div><span>${label}</span><strong title="${esc(label === '总 Token' ? full(o.total) : value)}">${esc(value)}</strong></div>`).join('')}</div>${heatmap(data)}</section>
      <section class="usage-card" aria-label="按模型用量">${header('模型')}${chart(data)}<div class="usage-models">${data.models.map((model, i) => `<div class="usage-model-row"><span class="usage-model-name"><i style="background:${color(i)}"></i><span title="${esc(model.modelId)}">${esc(model.modelId)}<small>${esc(model.providerId)}</small></span></span><span class="usage-model-count" title="${esc(`输入：${full(model.input)}；缓存读取：${full(model.cacheRead)}；缓存写入：${full(model.cacheWrite)}；输出：${full(model.output)}；推理：${full(model.reasoning)}`)}">${number(model.input + model.cacheRead + model.cacheWrite)} 输入 · ${number(model.output + model.reasoning)} 输出</span><strong>${(model.share * 100).toFixed(1)}%</strong></div>`).join('')}</div></section>`;
    page.querySelector('#usageScope').textContent = `来自本机保留的聊天记录，包含子智能体与已归档聊天。会话会把子智能体归入其父聊天；消息数统计用户与助手记录；输入包含缓存，输出包含推理。图像 / 视频、视觉中继以及聊天内核之外的调用不计入。${o.unreportedMessages ? `另有 ${full(o.unreportedMessages)} 条助手消息未上报用量。` : ''}`;
  }

  async function refresh(force = false) {
    const id = ++request;
    const status = page.querySelector('#usageStatus');
    page.setAttribute('aria-busy', 'true');
    status.textContent = '正在加载用量…';
    // Clear stale numbers so a new range never labels the previous result.
    page.querySelector('#usagePanels').replaceChildren();
    page.querySelector('#usageScope').textContent = '';
    try {
      const data = await window.yan.getUsageStats({ range, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, force });
      if (id !== request) return;
      if (!data?.ok) throw new Error(data?.error || '无法加载用量。');
      render(data); status.textContent = '';
    } catch (error) { if (id === request) status.textContent = `无法加载用量。${error.message}`; }
    finally { if (id === request) page.setAttribute('aria-busy', 'false'); }
  }
  page.addEventListener('click', event => {
    const button = event.target.closest('[data-usage-range]');
    if (button && button.dataset.usageRange !== range) { range = button.dataset.usageRange; void refresh(); }
  });
  page.querySelector('#usageRefresh').addEventListener('click', () => refresh(true));
  window.YanUsageSettings = { refresh };
})();
