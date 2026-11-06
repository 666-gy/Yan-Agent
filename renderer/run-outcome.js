(function(root) {
  'use strict';
  function userAbort(run) { return run?.status === 'interrupted' && run.interruptionReason === 'user_cancel'; }
  // The reply hard cap is not a user action: saying "用户手动中止输出" there
  // blames the user for a stalled provider.
  function responseTimeoutMessage(minutes) {
    const span = Number(minutes) > 0
      ? `在 ${Math.max(1, Math.round(Number(minutes)))} 分钟内`
      : '在规定时间内';
    return `模型${span}未成功回包，已自动中止。请检查网络或模型服务后重试。`;
  }
  function message(run) {
    if (run?.status !== 'interrupted') return run?.error || '';
    if (run.recoveredAfterRestart || run.interruptionReason === 'app_shutdown') return '应用退出导致运行中断，已保留现有内容';
    if (run.interruptionReason === 'response_timeout') return run.error || responseTimeoutMessage(run.responseTimeoutMinutes);
    if (userAbort(run)) return '用户手动中止输出';
    return run.error || '运行被系统中断，未收到用户取消请求。请查看运行日志。';
  }
  function reconcile(turn = {}) {
    if (turn.status === 'completed') return { status: 'done', error: '' };
    const user = turn.cancelReason === 'user_cancelled' && !!turn.telemetry?.cancelRequestedAt;
    if (turn.status === 'aborted') return { status: 'interrupted', interruptionReason: user ? 'user_cancel' : turn.result?.interruptionReason || 'system_interrupted', error: turn.result?.error || '' };
    return { status: 'error', interruptionReason: 'reconciliation', error: turn.result?.error || '内核任务未正常完成，收尾事件丢失；现有内容已保留。' };
  }
  const api = { userAbort, message, reconcile, responseTimeoutMessage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YanRunOutcome = api;
})(typeof window === 'object' ? window : globalThis);
