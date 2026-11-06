'use strict';

function normalizeExperiments(value = {}) {
  return { intelligentUi: value?.intelligentUi === true };
}

function canCreateIntelligentUi(request = {}) {
  return request.intelligentUiEnabled === true && request.intelligentUiAvailable === true
    && !request.utility && !request.skillOnly
    && request.workMode !== 'plan' && request.sandboxMode !== 'read-only'
    && request.permissions?.allowFileWrite !== false && request.permissions?.allowFileRead !== false;
}

function intelligentUiContext(request = {}) {
  if (request.utility || request.skillOnly) return '';
  if (request.intelligentUiEnabled !== true) return 'Yan experimental Intelligent UI is disabled for this turn. Do not proactively generate an inline mini-app, even if earlier turns enabled it. Explicit requests for ordinary interactive artifacts still follow the normal task workflow.';
  if (!canCreateIntelligentUi(request)) return 'Yan experimental Intelligent UI Creator is unavailable in this turn. Continue the ordinary workflow without bypassing the task restrictions.';
  const daily = require('./daily-agent').isDaily(request);
  return [
    'Yan laboratory: Intelligent UI is an inline visual response rendered by OpenUI. The current model decides whether interaction has concrete benefit; never add another classifier/model call or delegate this decision.',
    daily
      ? 'In daily mode, interactive UI is a way of expressing an answer, alongside prose and lists. Choose it naturally when seeing alternatives, changing assumptions or exploring an object helps understanding or decision-making. Do not announce a separate feature or ask the user to enable a task workflow. A simple answer stays simple.'
      : 'Interactive UI is a task capability. Use it when comparing alternatives, manipulating parameters or examining results materially helps complete the current task. Do not add UI for progress, approvals or routine clarification.',
    'Once useful, call yan_session_intelligent_ui_creator action=start with task_id, title, purpose and placement BEFORE spending a long reasoning stretch designing the UI. Do not write a file or open a browser. Then read the returned design skill and OpenUI contract and call action=render on the SAME tool.',
    'Prefer format=openui and code using the current official component catalog, local $state bindings and expressions. Use format=html only for custom visual or spatial interactions the catalog cannot express. Both paths share the same isolated host, resource grants and local persistence. There is no arbitrary network, filesystem or backend access.',
    'Timing: use during_work only when interaction helps the next step now. Otherwise render once the data is stable, before the final response. Never append another model turn solely to generate UI. Keep one panel per turn; later renders update it.',
    'Use researched data and label examples/estimates. Controls must change the relevant object or outcome, not merely switch decorative prose. Follow the returned contract for maps and approved photos; do not invent routes, coordinates, URLs or measurements.',
    'OpenUI state persists locally. HTML uses window.yanUi.getState/setState. Neither sends results to the model or authorizes work. Set handoff=true only for a concrete next conversation step; the host prepares a draft after a user click and never submits it.',
    'Keep the answer independently understandable without repeating interface content. Check representative calculations and the primary interaction. Tool success confirms delivery, not browser validation. If UI cannot be delivered, continue with a usable text answer.'
  ].filter(Boolean).join('\n');
}

module.exports = { normalizeExperiments, canCreateIntelligentUi, intelligentUiContext };
