// Copied unchanged from renderer/renderer.js.
let maxReasoningNoticeTimer = null;
function clearMaxReasoningNotice() {
  clearTimeout(maxReasoningNoticeTimer);
  maxReasoningNoticeTimer = null;
  document.querySelectorAll('.max-reasoning-notice').forEach(node => node.remove());
  document.querySelectorAll('.show-max-reasoning-notice').forEach(node => node.classList.remove('show-max-reasoning-notice'));
}

function showMaxReasoningNotice() {
  clearMaxReasoningNotice();
  for (const selector of ['#modelPill', '#modelQuickModelRoute']) {
    const target = $(selector);
    if (!target) continue;
    const notice = document.createElement('span');
    notice.className = 'max-reasoning-notice';
    notice.textContent = '更快消耗使用额度';
    notice.setAttribute('role', 'status');
    target.appendChild(notice);
    target.classList.add('show-max-reasoning-notice');
  }
  maxReasoningNoticeTimer = setTimeout(clearMaxReasoningNotice, 2000);
}

