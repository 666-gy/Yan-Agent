// The kernel appends its per-workspace facts to the first system message,
// ahead of Yan's larger stable instructions. Keep those facts in system scope
// but after the consecutive system prefix, so a new Blank directory does not
// invalidate the instructions that follow it. Never rewrite arbitrary prompts.
export function deferKernelEnvironment(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages[0]?.role !== 'system'
    || typeof messages[0].content !== 'string'
    || !messages[0].content.startsWith('You are opencode,')) return body;
  const content = messages[0].content;
  const marker = '\n\nYou are powered by the model named ';
  const offset = content.lastIndexOf(marker);
  if (offset < 0) return body;
  const environment = content.slice(offset + 2);
  if (!/^You are powered by the model named [^\n]+\nHere is some useful information about the environment you are running in:\n<env>\n  Working directory: [^\n]+\n  Workspace root folder: [^\n]+\n  Is directory a git repo: (?:yes|no)\n  Platform: [^\n]+\n  Today's date: [^\n]+\n<\/env>$/u.test(environment)) return body;
  let last = 0;
  while (messages[last + 1]?.role === 'system' && typeof messages[last + 1].content === 'string') last++;
  if (!last) return body;
  const next = messages.slice();
  next[0] = { ...messages[0], content: content.slice(0, offset) };
  next[last] = { ...messages[last], content: messages[last].content + '\n\n' + environment };
  return { ...body, messages: next };
}
