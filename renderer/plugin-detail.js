/* Hallmark · screenshot-led detail · existing Yan tokens · P5 H5 E4 S5 R5 V4 */
window.YanPluginDetails = (() => {
  const external = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>';
  function toggle(action, label, checked, disabled, extra = '') {
    return `<input type="checkbox" role="switch" class="switch" data-plugin-action="${action}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled data-fixed-disabled' : ''} ${extra}>`;
  }
  function render(item, { expanded, group, remove }) {
    const current = item.installation, info = item.presentation || {};
    const skills = current?.skills || item.skills || [], shown = expanded ? skills : skills.slice(0, 5);
    const accounts = current?.accounts || [];
    const connected = accounts.length && accounts.every(account => account.state === 'connected');
    const state = current ? (current.ready ? (current.enabled ? '已启用' : '已关闭') : '需要处理') : '未安装';
    const directory = current ? `<button type="button" class="plugin-directory icon-btn" data-plugin-action="directory" aria-label="在资源管理器中打开" title="在资源管理器中打开"><img src="assets/windows-explorer.png" alt="" aria-hidden="true"></button>` : '';
    const actions = current ? `${toggle('toggle', `启用 ${item.name}`, current.enabled, false)}${remove}` : '<button type="button" class="skill-detail-install" data-plugin-action="install">安装插件</button>';
    const link = (kind, label) => info[kind] ? `<button type="button" class="plugin-info-link icon-btn" data-plugin-action="link" data-link-kind="${kind}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${external}</button>` : '<span class="plugin-info-missing">—</span>';
    const rows = [
      ['功能', escapeHtml(info.capabilities?.join(', ') || '未声明')],
      ['开发者', escapeHtml(info.developer || item.author || '未声明')],
      ['类别', escapeHtml(group)], ['版本', escapeHtml(current?.version || item.version || '—')],
      ['网站', link('website', `打开 ${item.name} 网站`)], ['隐私政策', link('privacy', `打开 ${item.name} 隐私政策`)], ['服务条款', link('terms', `打开 ${item.name} 服务条款`)]
    ];
    return `${window.YanCapabilityTemplates.compactDetailHead({
        titleId: 'pluginDetailTitle', name: item.name, description: info.shortDescription || item.description,
        logo: skillLogoHtml(item), actions, actionLabel: '插件操作', afterTitle: directory,
        closeAttribute: 'data-plugin-action', closeLabel: '关闭插件详情',
        extra: `<span class="sr-only" id="pluginDetailState">${state}</span>`
      })}
      ${window.YanPluginExamples.render(item)}
      <p class="plugin-detail-description" ${item.id === 'yan-computer-use' ? 'lang="en" translate="no"' : ''}>${escapeHtml(info.longDescription || item.description)}</p>
      ${accounts.length ? `<section class="plugin-account-section" aria-label="账号连接"><div><h2>账号连接 · ${connected ? '已连接' : accounts.some(account => account.state === 'connecting') ? '等待授权' : '未连接'}</h2><p>${escapeHtml(accounts.map(account => account.message || (account.state === 'connected' ? '账号已连接。' : '请在系统浏览器中授权。')).join(' '))}</p></div><button type="button" class="ghost-btn" data-plugin-action="${connected ? 'disconnect' : 'connect'}">${connected ? '断开账号' : '连接账号'}</button></section>` : ''}
      ${current && !current.ready ? `<div class="plugin-preparation" role="status"><p>${escapeHtml(current.issues.join('；'))}</p><button type="button" class="ghost-btn" data-plugin-action="prepare">重新检查</button></div>` : ''}
      <section class="plugin-skills-section" aria-labelledby="pluginSkillsTitle"><h2 id="pluginSkillsTitle">技能 <span>${skills.length}</span></h2>
        <div class="plugin-skill-list" id="pluginSkillList">${shown.map(skill => `<article class="plugin-skill-row"><div class="plugin-skill-logo">${skillLogoHtml(item)}</div><div class="plugin-skill-copy"><h3>${item.id === 'yan-computer-use' ? '' : '/'}${escapeHtml(skill.name)}</h3><p>${escapeHtml(skill.description)}</p></div>${toggle('skill', `启用技能 ${skill.name}`, !!current && skill.enabled !== false, !current, `data-skill-id="${escapeAttr(skill.id)}"`)}</article>`).join('') || '<p class="plugin-info-missing">此插件不包含技能。</p>'}</div>
        ${skills.length > 5 ? `<button type="button" class="plugin-skills-more" data-plugin-action="expand" aria-expanded="${expanded}" aria-controls="pluginSkillList"><span class="plugin-skills-stack" aria-hidden="true">${[0, 1, 2].map(() => skillLogoHtml(item)).join('')}</span><span>${expanded ? '收起技能' : `查看其余 ${skills.length - 5} 项技能`}</span></button>` : ''}
      </section>
      <section class="plugin-info-section" aria-labelledby="pluginInfoTitle"><h2 id="pluginInfoTitle">信息</h2><dl>${rows.map(([label, value]) => `<div class="plugin-info-row"><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></section>`;
  }
  return { render, externalIcon: external };
})();
