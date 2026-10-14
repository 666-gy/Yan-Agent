/* Shared Skill / plugin market primitives. Keep layout and styling in styles.css. */
window.YanCapabilityTemplates = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function card({ attributes, name, description, logo, badge = '', actions, label }) {
    return `<article class="skill-card" ${attributes} role="button" tabindex="0" aria-label="${escape(label)}">
      <div class="skill-card-logo">${logo}</div>
      <div class="skill-card-primary"><div class="skill-card-name-row"><span class="skill-card-name">${escape(name)}</span>${badge}</div><p class="skill-card-desc">${escape(description || '暂无说明')}</p></div>
      <div class="skill-card-actions">${actions}</div>
    </article>`;
  }
  function group({ id, attributes = '', name, description, cards }) {
    return `<section class="skill-market-group" ${attributes} aria-labelledby="${escape(id)}">
      <header class="skill-market-group-head"><div class="skill-market-group-title"><h3 id="${escape(id)}">${escape(name)}</h3><p>${escape(description)}</p></div></header>
      <div class="skill-group-grid">${cards}</div></section>`;
  }
  function compactDetailHead({ titleId, name, description, logo, actions, actionLabel, closeAttribute, closeLabel, afterTitle = '', extra = '' }) {
    const close = document.getElementById('skillImportCloseBtn').cloneNode(true);
    close.removeAttribute('id');
    close.setAttribute(closeAttribute, 'back');
    close.setAttribute('aria-label', closeLabel);
    close.title = closeLabel;
    return `<div class="plugin-detail-close">${close.outerHTML}</div>
      <header class="plugin-detail-header">
        ${logo ? `<div class="plugin-detail-logo">${logo}</div>` : ''}
        <div class="plugin-detail-title-row"><div class="plugin-detail-name"><h1 id="${escape(titleId)}">${escape(name)}</h1>${afterTitle}</div><div class="plugin-detail-actions" role="group" aria-label="${escape(actionLabel)}">${actions}</div></div>
        ${description === null ? '' : `<p class="plugin-detail-subtitle">${escape(description || '暂无说明')}</p>`}
        ${extra}
      </header>`;
  }
  // Clone the existing Skill header so labels and markup
  // stay in one place. cloneNode deliberately does not copy Skill event handlers.
  function marketHeader(prefix, title, description, { addLabel = '' } = {}) {
    const header = document.querySelector('#pageSkills > .capability-page-header').cloneNode(true);
    header.classList.remove('hidden');
    header.querySelector('h2').textContent = title;
    header.querySelector('.page-sub').textContent = description;
    const actions = header.querySelector('.capability-header-actions');
    if (addLabel) {
      const add = actions.querySelector('#skillImportBtn');
      add.title = addLabel;
      add.setAttribute('aria-label', addLabel);
      actions.replaceChildren(add);
    } else actions?.remove();
    for (const node of [header, ...header.querySelectorAll('*')]) {
      for (const attr of ['id', 'for', 'aria-controls', 'aria-labelledby']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replace(/^skill/, prefix));
      }
      for (const attr of ['title', 'aria-label']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replace(/Skill|技能/g, title));
      }
    }
    return header;
  }
  return { card, group, compactDetailHead, marketHeader };
})();
