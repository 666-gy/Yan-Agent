(() => {
 const $ = id => document.getElementById(id);
 let entries = [], editing = '', deleting = null;
 const notice = (error, id = 'passwordError') => { $(id).textContent = error?.message || ''; $(id).hidden = !error; };
 function tab(advanced) {
  $('passwordListPanel').hidden = advanced; $('passwordAdvancedPanel').hidden = !advanced;
  $('passwordTab').setAttribute('aria-selected', String(!advanced)); $('passwordAdvancedTab').setAttribute('aria-selected', String(advanced));
 }
 async function load() { entries = await api.browserPasswordList(); render(); }
 function render() {
  const list = $('passwordList'); list.replaceChildren();
  const query = $('passwordSearch').value.toLocaleLowerCase().trim();
  const matches = entries.filter(item => `${item.url} ${item.username}`.toLocaleLowerCase().includes(query));
  for (const item of matches) {
   const row = document.createElement('div'); row.className = 'password-row';
   const info = document.createElement('div'); info.className = 'password-row-info';
   const site = document.createElement('strong'); site.textContent = new URL(item.url).host; site.title = item.url;
   const username = document.createElement('p'); username.textContent = item.username || '未设置用户名';
   const secret = document.createElement('span'); secret.textContent = '••••••••'; secret.className = 'password-masked';
   info.append(site, username); row.append(info, secret);
   for (const [text, action] of [['编辑', () => edit(item.id)], ['删除', () => confirmDelete(item.id)]]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'browser-pill'; button.textContent = text; button.onclick = () => Promise.resolve(action()).catch(notice); row.append(button);
   }
   list.append(row);
  }
  if (!matches.length) { const empty = document.createElement('div'); empty.className = 'password-empty'; empty.textContent = query ? '没有找到匹配的密码' : '尚未保存密码，点击“添加新密码”开始'; list.append(empty); }
 }
 async function edit(id = '') {
  notice(null, 'passwordFormError'); $('passwordForm').reset(); $('passwordSecret').type = 'password'; $('passwordReveal').setAttribute('aria-label', '显示密码');
  editing = id;
  if (id) { const item = await api.browserPasswordGet(id); $('passwordUrl').value = item.url; $('passwordUsername').value = item.username; $('passwordSecret').value = item.password; }
  $('passwordEditTitle').textContent = id ? '编辑密码' : '添加新密码'; $('passwordEditDialog').showModal(); $('passwordUrl').focus();
 }
 function confirmDelete(id) { deleting = id; $('passwordDeleteTitle').textContent = id ? '删除这条密码？' : '删除所有密码管理器数据？'; $('passwordDeleteDialog').showModal(); }
 $('browserPasswordsManage').onclick = async () => {
  window.YanBrowserSettings.sync(); $('browserPreferences').hidden = true; $('browserPasswordsPage').hidden = false;
  settingsOverlay.classList.add('browser-history-open'); tab(false); $('browserPasswordsClose').focus();
  $('passwordOfferSave').checked = state.config.browserPasswords?.offerSave !== false; $('passwordAutoLogin').checked = state.config.browserPasswords?.autoLogin !== false;
  $('passwordPasskeyUpgrade').checked = state.config.browserPasswords?.offerPasskeyUpgrade !== false;
  try { await load(); notice(null); } catch (error) { notice(error); }
 };
 $('browserPasswordsClose').onclick = () => { window.YanBrowserSettings.sync(); $('browserPasswordsManage').focus(); };
 $('passwordTab').onclick = () => tab(false); $('passwordAdvancedTab').onclick = () => tab(true);
 document.querySelector('.password-tabs').addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const advanced = event.key === 'End' || (event.key !== 'Home' && $('passwordAdvancedPanel').hidden); tab(advanced); $(advanced ? 'passwordAdvancedTab' : 'passwordTab').focus(); } });
 for (const [id, key] of [['passwordOfferSave','offerSave'], ['passwordAutoLogin','autoLogin'], ['passwordPasskeyUpgrade','offerPasskeyUpgrade']]) $(id).onchange = async () => { const input = $(id); input.disabled = true; try { state.config = await api.setConfig({browserPasswords:{[key]:input.checked}}); notice(null); } catch (error) { input.checked = !input.checked; notice(error); } finally { input.disabled = false; } };
 $('passwordSearch').oninput = render;
 $('passwordAdd').onclick = () => edit().catch(notice);
 $('passwordReveal').onclick = () => { const show = $('passwordSecret').type === 'password'; $('passwordSecret').type = show ? 'text' : 'password'; $('passwordReveal').setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); };
 $('passwordCancel').onclick = () => $('passwordEditDialog').close();
 $('passwordEditDialog').addEventListener('close', () => { $('passwordForm').reset(); $('passwordSecret').type = 'password'; editing = ''; });
 $('passwordForm').onsubmit = async event => {
  event.preventDefault(); $('passwordSave').disabled = true;
  try { await api.browserPasswordSave({ id: editing, url: $('passwordUrl').value, username: $('passwordUsername').value, password: $('passwordSecret').value }); $('passwordEditDialog').close(); await load(); notice(null); }
  catch (error) { notice(error, 'passwordFormError'); } finally { $('passwordSave').disabled = false; }
 };
 $('passwordClear').onclick = () => confirmDelete(null);
 $('passwordDeleteCancel').onclick = () => $('passwordDeleteDialog').close();
 $('passwordDeleteConfirm').onclick = async () => {
  $('passwordDeleteConfirm').disabled = true;
  try { if (deleting) await api.browserPasswordRemove(deleting); else await api.browserPasswordClear(); $('passwordDeleteDialog').close(); await load(); notice(null); }
  catch (error) { $('passwordDeleteDialog').close(); notice(error); } finally { $('passwordDeleteConfirm').disabled = false; }
 };
})();
