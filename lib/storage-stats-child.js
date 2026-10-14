'use strict';
const { collectStorageStats, collectStorageReview } = require('./storage-stats');
const job = JSON.parse(process.argv[2] || '{}');
(job.review ? collectStorageReview(job) : collectStorageStats(job))
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
