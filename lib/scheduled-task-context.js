'use strict';

// Resolve from host-owned records, including a manual resend of the saved task
// description. Merely chatting in a scheduled task must not execute it again.
function resolveScheduledTaskContext(request = {}, session, store) {
  if (request.utility || !session?.scheduledTaskId) return null;
  const task = store?.get(session.scheduledTaskId);
  if (!task) return null;
  const explicitRun = request.scheduledTaskId === task.id && Number(request.scheduledRunAt) > 0;
  const repeatedDescription = String(request.prompt || '').trim() === String(task.description || '').trim();
  return {
    id: task.id,
    description: task.description,
    execution: explicitRun || repeatedDescription,
    ...(explicitRun ? { scheduledRunAt: Number(request.scheduledRunAt) } : {})
  };
}

function scheduledTaskExecutionContext(context) {
  if (!context) return '';
  if (!context.execution) return [
    '<yan-scheduled-task-context>',
    'This conversation belongs to an existing scheduled task managed by the host. The current message is a user follow-up, not an automatic execution. Answer the current request; do not repeat the scheduled action unless asked.',
    '</yan-scheduled-task-context>'
  ].join('\n');
  return [
    '<yan-scheduled-task-execution>',
    'The host has already created this scheduled task and triggered this occurrence (or the user is manually rerunning it). Execute the requested outcome NOW. The task description is the work for this occurrence, not a request to create, schedule, verify, or repair the scheduler.',
    'If the task only asks to remind or notify the user of something, your final reply in this conversation IS the reminder. Say the reminder directly in one short sentence and end the turn. For example, “提醒我玩游戏” means reply “该玩游戏了！” now. Do not add a plan, progress updates, a creation confirmation, or an offer to set another reminder. Do not call tools or discover Skills/MCP/session capabilities for a reminder that needs no external facts or actions.',
    'If the task requires current facts, a condition check, or an external action, do only that work with the relevant tools, then deliver its result. A reminder to do something does not authorize doing that thing on the user’s behalf. Do not reduce research, monitoring, or other real work to a generic reminder.',
    'Scheduling, occurrence status, and delivery to this conversation are owned by the host. Do not inspect task records, application files, logs, or other sessions to confirm that the schedule exists or diagnose an earlier error. Earlier creation messages, failed runs, and unfinished diagnostic work are historical context, not work to resume in this occurrence. Only an explicit current request to troubleshoot the scheduler authorizes such investigation.',
    '</yan-scheduled-task-execution>'
  ].join('\n');
}

module.exports = { resolveScheduledTaskContext, scheduledTaskExecutionContext };
