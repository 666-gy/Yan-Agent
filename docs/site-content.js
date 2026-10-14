/* Guide building blocks. Each docs/guides/*.js file calls YanGuide.add(...); load order is reading order.
 * Release data is generated separately from the application's offline notes. */
window.YanDocs = [];
window.YanGuide = (() => {
  const shots = window.YanSiteShots || {};
  const escape = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const p = (text) => `<p>${text}</p>`;
  const list = (items, ordered = false) =>
    `<${ordered ? "ol" : "ul"}>${items.map((item) => `<li>${item}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
  // Numbered procedure. Prefer this over list(..., true) for click-by-click instructions.
  const steps = (items) => `<ol class="steps">${items.map((item) => `<li>${item}</li>`).join("")}</ol>`;
  const note = (text) => `<aside class="callout">${text}</aside>`;
  const prompt = (text) => `<blockquote class="prompt">${text}</blockquote>`;
  const table = (heads, rows) =>
    `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  // Exact on-screen label, e.g. ui("新建连接"). Use " → " between levels: ui("设置 → 浏览器").
  const ui = (label) => `<span class="ui">${label}</span>`;
  const kbd = (keys) => keys.split("+").map((k) => `<kbd>${k}</kbd>`).join("+");
  // Screenshot slot: save docs/assets/shots/<id>.webp, then run node scripts/sync-site-content.cjs.
  const slots = [];
  const shot = (id, caption, className = "") => {
    slots.push({ id, caption });
    const src = shots[id];
    if (!src) return "";
    return `<figure class="shot has-image ${className}" data-shot="${id}"><img src="${src}" alt="${escape(caption)}" loading="lazy" decoding="async"><figcaption>${escape(caption)}</figcaption></figure>`;
  };
  const section = (id, title, html) => ({ id, title, html });
  const doc = (id, title, group, description, sections) => ({ id, title, group, description, sections });
  const add = (...docs) => window.YanDocs.push(...docs);
  return { p, list, steps, note, prompt, table, ui, kbd, shot, slots, section, doc, add, escape };
})();
