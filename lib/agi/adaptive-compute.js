'use strict';

// P0-4: difficulty-adaptive test-time compute.
// Start at the cheap tier; only uncertainty signals (tool/acceptance failures,
// repeated keys, loops) escalate best-of-n and the reasoning effort tier.

const EFFORT_LADDER = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

function positiveInt(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

// observe(): tool failure/success drives consecutiveFailures; acceptance
// failure/success drives acceptanceFails; loop events or repeated keys drive
// repeatedCount (a changed key resets it).
function createEscalationTracker({ failureThreshold = 3, maxBestOfN = 3 } = {}) {
  const threshold = positiveInt(failureThreshold, 3);
  const cap = positiveInt(maxBestOfN, 3);
  let consecutiveFailures = 0;
  let acceptanceFails = 0;
  let repeatedCount = 0;
  let lastKey = null;

  function observe(event = {}) {
    const type = event.type;
    const ok = event.ok;
    if (type === 'tool') {
      if (ok === false) consecutiveFailures += 1;
      else if (ok === true) consecutiveFailures = 0;
    } else if (type === 'acceptance') {
      if (ok === false) acceptanceFails += 1;
      else if (ok === true) acceptanceFails = 0;
    }
    if (type === 'loop') repeatedCount += 1;
    if (event.key !== undefined && event.key !== null && String(event.key) !== '') {
      const key = String(event.key);
      if (lastKey === null) lastKey = key;
      else if (lastKey === key) repeatedCount += 1;
      else {
        repeatedCount = 0;
        lastKey = key;
      }
    }
    return state();
  }

  function decide() {
    const acceptanceTier2 = acceptanceFails >= 2;
    const toolTier2 = consecutiveFailures >= threshold * 2;
    const loopTier2 = repeatedCount >= 6;
    if (acceptanceTier2 || toolTier2 || loopTier2) {
      const reasons = [];
      if (acceptanceTier2) reasons.push(`验收连续 ${acceptanceFails} 次未过`);
      if (toolTier2) reasons.push(`连续失败 ${consecutiveFailures} 次`);
      if (loopTier2) reasons.push(`重复/循环信号 ${repeatedCount} 次`);
      return {
        escalate: true,
        tier: 2,
        bestOfN: cap,
        reason: `${reasons.join('，')}，升级 best-of-${cap} 并提高推理档位`
      };
    }
    const acceptanceTier1 = acceptanceFails >= 1;
    const toolTier1 = consecutiveFailures >= threshold;
    if (acceptanceTier1 || toolTier1) {
      const reasons = [];
      if (acceptanceTier1) reasons.push('验收未通过');
      if (toolTier1) reasons.push(`连续失败 ${consecutiveFailures} 次`);
      return {
        escalate: true,
        tier: 1,
        bestOfN: 2,
        reason: `${reasons.join('，')}，升级 best-of-2 并提高推理档位`
      };
    }
    return { escalate: false, tier: 0, bestOfN: 1, reason: '常规档：无不确定信号，保持 best-of-1' };
  }

  function state() {
    return {
      consecutiveFailures,
      acceptanceFails,
      repeatedCount,
      lastKey,
      failureThreshold: threshold,
      maxBestOfN: cap,
      ...decide()
    };
  }

  function reset() {
    consecutiveFailures = 0;
    acceptanceFails = 0;
    repeatedCount = 0;
    lastKey = null;
    return state();
  }

  return { observe, state, decide, reset };
}

// Raises an effort tier by steps, clamped to the ladder; unknown base = medium.
function raiseEffort(base, steps = 1) {
  const rawIndex = EFFORT_LADDER.indexOf(
    String(base === undefined || base === null ? '' : base).toLowerCase()
  );
  const from = rawIndex === -1 ? 1 : rawIndex;
  const rawSteps = Math.floor(Number(steps));
  const count = Number.isFinite(rawSteps) ? Math.max(0, rawSteps) : 0;
  return EFFORT_LADDER[Math.min(EFFORT_LADDER.length - 1, from + count)];
}

module.exports = { createEscalationTracker, raiseEffort };
