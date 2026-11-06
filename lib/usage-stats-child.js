'use strict';
const { readUsageDatabase, usageDatabaseFiles } = require('./usage-stats');
try {
  const job = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify({ ok: true, ...readUsageDatabase(job.dataDir ? usageDatabaseFiles(job.dataDir) : job.file, job.options) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
