'use strict';

const admissionLanes = new WeakMap();

function lanesFor(admissions) {
  if (!admissionLanes.has(admissions)) admissionLanes.set(admissions, new Map());
  return admissionLanes.get(admissions);
}

function laneCount(active, admissions, lane) {
  const lanes = lanesFor(admissions);
  return [...active.values()].filter(run => (run.runLane || 'interactive') === lane).length
    + [...admissions.keys()].filter(id => (lanes.get(id) || 'interactive') === lane).length;
}

module.exports = { lanesFor, laneCount };
