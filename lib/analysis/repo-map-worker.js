'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { buildRepoMap } = require('./repo-map');
try { parentPort.postMessage({ text: buildRepoMap(workerData.workspace, workerData.options).text }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
