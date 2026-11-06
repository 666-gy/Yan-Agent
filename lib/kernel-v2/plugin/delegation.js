import { z } from 'zod';

export async function installDelegation(ctx) {
  if (!process.env.YAN_DELEGATION_URL) return;
  const identity = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
  const revision = z.number().int().min(1);
  const definitions = {
    workflow_plan: ['Create or revise a durable team workflow. Preserve IDs and executed tasks. Dependencies unlock after acceptance. writeScopes lists relative files/directories; [] means read-only intent, * means the whole workspace. Planning does not start a new workflow; call workflow_run. Inspect for the latest revision before mutations.', z.object({
      revision: revision.optional(), goal: z.string().min(1).max(4000),
      members: z.array(z.object({ id: identity, name: z.string().min(1).max(120) })).min(1).max(100),
      stages: z.array(z.object({ id: identity, title: z.string().min(1).max(200) })).min(1).max(100),
      tasks: z.array(z.object({ id: identity, stageId: identity, memberId: identity, title: z.string().min(1).max(200), prompt: z.string().min(1).max(20000), acceptance: z.string().min(1).max(4000), dependsOn: z.array(identity).max(100), writeScopes: z.array(z.string().max(500)).max(40) })).min(1).max(100)
    })],
    workflow_run: ['Start/resume scheduling ready workflow tasks. Submitted results still require explicit workflow_review. Interrupted/error tasks require rework before retrying.', z.object({ revision })],
    workflow_review: ['Accept or request rework of the exact task attempt, with concrete evidence. Only accept submitted results. Rework reuses member context where available. Rework of accepted tasks with started dependents requires explicit correction/revalidation tasks instead.', z.object({ revision, taskId: identity, attempt: z.number().int().min(1), decision: z.enum(['accept', 'rework']), evidence: z.string().min(1).max(8000) })],
    workflow_inspect: ['Read durable workflow, dependencies, results, attempts, review evidence and current revision. Does not execute work.', z.object({})],
    workflow_pause: ['Pause scheduling and interrupt active workflow members. Completed results remain available for review; interrupted work requires explicit rework before retry.', z.object({ revision })],
    spawn_agent: ['Delegate independent work and immediately continue your own work. No role presets. Include scope, context and expected deliverable in prompt. If capacity is full it waits briefly for a slot; a timeout is an explicit capacity error, not a reason to retry in a loop.', z.object({ name: z.string().min(1).max(120), prompt: z.string().min(1).max(60000) })],
    send_agent_message: ['Send follow-up instructions to your own child; a completed child resumes its existing context. Messages cannot grant permissions.', z.object({ id: z.string(), message: z.string().min(1).max(60000) })],
    list_agents: ['Read your children and their execution results. Completion is not acceptance.', z.object({})],
    wait_agents: ['Wait for a child result when you need it. Returns on completion or timeout; other agents continue.', z.object({ ids: z.array(z.string()).optional(), timeout_ms: z.number().int().min(1).max(60000).optional() })],
    interrupt_agent: ['Stop a child and its descendants and wait for cleanup. Its conversation can be resumed.', z.object({ id: z.string() })],
    close_agent: ['Stop and close a child and its descendants. History remains; this agent cannot be resumed.', z.object({ id: z.string() })]
  };
  await ctx.tool.transform(editor => {
    for (const [name, [description, input]] of Object.entries(definitions)) editor.add({ name, description, input,
      options: { codemode: false, permission: 'yan_delegate' },
      execute: async (input, context) => {
        context.signal?.throwIfAborted();
        const response = await fetch(process.env.YAN_DELEGATION_URL, { method: 'POST', signal: context.signal,
          headers: { authorization: `Bearer ${process.env.YAN_DELEGATION_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: name, input, sessionID: context.sessionID, callID: context.id }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Delegation failed');
        return { content: JSON.stringify(result) };
      }
    });
  });
  await ctx.session.hook('context', async event => {
    const session = await ctx.session.get({ sessionID: event.sessionID });
    if (!session.permissions?.some(rule => rule.action === 'yan_delegate' && rule.effect === 'allow')) {
      for (const name of Object.keys(event.tools)) if (definitions[name]) delete event.tools[name];
    }
  });
}
