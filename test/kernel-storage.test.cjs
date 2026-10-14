'use strict';

// Storage budget for the kernel database (plan item 6). Two rules are load
// bearing and every test here exists to hold them: sessions, messages and parts
// are never deleted, and a rebuild never runs while a kernel has the database
// open. Integration cases run against a real SQLite file in a temp directory -
// never the user's database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const storage = require('../lib/kernel-storage');
const {
  LIMITS,
  databasePaths,
  measureFiles,
  shouldInspect,
  fileWarnings,
  planStorageMaintenance,
  compactPermissionRules,
  readState,
  publishedKernelPorts,
  stepBudget,
  maintainRuntimeStorage,
  ensureRuntimeStorage,
  startStorageMonitor
} = storage;

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const tempRoots = [];
test.after(() => {
  for (const root of tempRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

function tempRuntimeRoot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-storage-'));
  tempRoots.push(dataDir);
  const runtimeRoot = path.join(dataDir, 'opencode-runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'data', 'opencode'), { recursive: true });
  return { dataDir, runtimeRoot, paths: databasePaths(runtimeRoot) };
}

// The tables and columns the maintenance touches, in the shape the kernel uses.
// `part` stands in for all the rows that must survive every pass.
function createDatabase(file, { events = 0, sessions = [], projectionRows = 0, parts = 0 } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, permission TEXT)');
  db.exec('CREATE TABLE event (id INTEGER PRIMARY KEY, data TEXT)');
  db.exec('CREATE TABLE event_sequence (name TEXT PRIMARY KEY, value INTEGER)');
  db.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, body TEXT)');
  db.exec('CREATE TABLE session_input (id TEXT PRIMARY KEY, body TEXT)');
  db.exec('CREATE TABLE session_context_epoch (id TEXT PRIMARY KEY, body TEXT)');
  db.exec('CREATE TABLE part (id TEXT PRIMARY KEY, body TEXT)');

  const filler = 'x'.repeat(480);
  db.exec('BEGIN');
  const insertEvent = db.prepare('INSERT INTO event (data) VALUES (?)');
  for (let index = 0; index < events; index += 1) insertEvent.run(`${index}:${filler}`);
  const insertSession = db.prepare('INSERT INTO session (id, permission) VALUES (?, ?)');
  for (const session of sessions) insertSession.run(session.id, JSON.stringify(session.permission));
  const insertProjection = db.prepare('INSERT INTO session_message (id, body) VALUES (?, ?)');
  for (let index = 0; index < projectionRows; index += 1) insertProjection.run(`m${index}`, filler);
  const insertPart = db.prepare('INSERT INTO part (id, body) VALUES (?, ?)');
  for (let index = 0; index < parts; index += 1) insertPart.run(`p${index}`, filler);
  db.exec('COMMIT');

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

// A permission array as the append-only sync left it: the same rules, over and
// over, with only the last copy of each pair still deciding anything.
function duplicatedRules(copies, patterns = ['bash', 'edit', 'webfetch']) {
  const rules = [];
  for (let round = 0; round < copies; round += 1) {
    for (const pattern of patterns) rules.push({ permission: 'ask', pattern, note: `round-${round}` });
  }
  return rules;
}

function scalar(file, sql) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.values(db.prepare(sql).get() || {})[0]; } finally { db.close(); }
}

const rowCount = (file, table) => Number(scalar(file, `select count(*) as value from ${table}`));
const kinds = list => list.map(item => item.kind);

// --- thresholds -------------------------------------------------------------

test('shouldInspect only wakes up for a large database or a large WAL', () => {
  assert.equal(shouldInspect({ exists: false, totalBytes: 99 * GiB, walBytes: 99 * GiB }), false);
  assert.equal(shouldInspect({ exists: true, totalBytes: 100 * MiB, walBytes: 8 * MiB }), false);
  assert.equal(shouldInspect({ exists: true, totalBytes: LIMITS.inspectBytes, walBytes: 0 }), true);
  assert.equal(shouldInspect({ exists: true, totalBytes: 10 * MiB, walBytes: LIMITS.inspectWalBytes }), true);
});

test('fileWarnings reports a large database and a low disk separately', () => {
  assert.deepEqual(fileWarnings({ exists: true, dbBytes: 10 * MiB, walBytes: 0, totalBytes: 10 * MiB, freeBytes: 500 * GiB }), [], 'both checks can come back clean');
  assert.deepEqual(kinds(fileWarnings({ exists: true, dbBytes: 5 * GiB, walBytes: 0, totalBytes: 5 * GiB, freeBytes: 500 * GiB })), ['database-large']);
  assert.deepEqual(kinds(fileWarnings({ exists: true, dbBytes: 10 * MiB, walBytes: 0, totalBytes: 10 * MiB, freeBytes: 1 * GiB })), ['disk-low']);
  assert.deepEqual(
    kinds(fileWarnings({ exists: true, dbBytes: 5 * GiB, walBytes: 0, totalBytes: 5 * GiB, freeBytes: 1 * GiB })).sort(),
    ['database-large', 'disk-low']
  );
});

test('measureFiles reports zero for a runtime root without a database', () => {
  const { runtimeRoot } = tempRuntimeRoot();
  const files = measureFiles(runtimeRoot);
  assert.equal(files.exists, false);
  assert.equal(files.dbBytes, 0);
  assert.equal(files.totalBytes, 0);
  assert.equal(files.freeBytes, 0, 'no statfs for a database that does not exist');
  assert.deepEqual(fileWarnings(files), []);
});

// --- permission compaction ---------------------------------------------------

test('compactPermissionRules keeps the last rule of each permission/pattern pair', () => {
  const rules = [
    { permission: 'bash', pattern: '*', action: 'ask' },
    { permission: 'edit', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: 'git *', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'ask' }
  ];
  assert.deepEqual(compactPermissionRules(rules), [
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: 'git *', action: 'allow' },
    { permission: 'edit', pattern: '*', action: 'ask' }
  ]);
});

test('compactPermissionRules decides every lookup exactly like the original array', () => {
  const rules = [];
  const actions = ['allow', 'ask', 'deny'];
  for (let round = 0; round < 40; round += 1) {
    for (const permission of ['bash', 'edit', 'read']) {
      for (const pattern of ['*', 'src/*', 'git *']) {
        rules.push({ permission, pattern, action: actions[(round + permission.length + pattern.length) % 3] });
      }
    }
  }
  // The last matching rule wins, which is how the kernel resolves them.
  const decide = (list, permission, pattern) => list
    .filter(rule => rule.permission === permission && rule.pattern === pattern).at(-1)?.action;
  const compacted = compactPermissionRules(rules);
  assert.equal(compacted.length, 9);
  for (const permission of ['bash', 'edit', 'read', 'webfetch']) {
    for (const pattern of ['*', 'src/*', 'git *', 'other']) {
      assert.equal(decide(compacted, permission, pattern), decide(rules, permission, pattern), `${permission} ${pattern}`);
    }
  }
});

test('compactPermissionRules tolerates non-arrays and odd items', () => {
  assert.deepEqual(compactPermissionRules(null), []);
  assert.deepEqual(compactPermissionRules('bash'), []);
  assert.equal(compactPermissionRules([null, { permission: 'bash', pattern: '*' }, null]).length, 2);
});

// --- planning ----------------------------------------------------------------

const bigFiles = (overrides = {}) => ({
  exists: true,
  dbBytes: 3 * GiB,
  walBytes: 0,
  totalBytes: 3 * GiB,
  freeBytes: 100 * GiB,
  ...overrides
});
const emptyProjections = () => ['session_message', 'session_input', 'session_context_epoch']
  .map(name => ({ name, exists: true, rows: 0 }));

test('plan: a running kernel means nothing is written, whatever the numbers say', () => {
  const plan = planStorageMaintenance({
    files: bigFiles(),
    rows: { event: 10_000_000 },
    projectionTables: emptyProjections(),
    sessions: [{ id: 's1', bytes: 50 * MiB }],
    pageSize: 4096,
    freelistCount: 500_000
  }, { liveKernel: true, liveKernelPort: 4321 });
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.skipped, 'kernel-running');
  assert.deepEqual(plan.warnings.find(item => item.kind === 'kernel-running'), { kind: 'kernel-running', port: 4321 });
});

test('plan: the event log is cleared only when every projection table exists and is empty', () => {
  const facts = projectionTables => ({ files: bigFiles(), rows: { event: LIMITS.eventRows + 1 }, projectionTables });
  assert.ok(kinds(planStorageMaintenance(facts(emptyProjections())).actions).includes('clear-event-log'));

  const withRows = emptyProjections();
  withRows[1].rows = 3;
  const inUse = planStorageMaintenance(facts(withRows));
  assert.ok(!kinds(inUse.actions).includes('clear-event-log'));
  assert.ok(kinds(inUse.warnings).includes('event-log-in-use'));

  const missing = emptyProjections();
  missing[2] = { name: 'session_context_epoch', exists: false, rows: 0 };
  assert.ok(!kinds(planStorageMaintenance(facts(missing)).actions).includes('clear-event-log'));

  // Unknown projections (another schema) never count as empty.
  assert.ok(!kinds(planStorageMaintenance(facts([])).actions).includes('clear-event-log'));

  const small = planStorageMaintenance({ files: bigFiles(), rows: { event: LIMITS.eventRows }, projectionTables: emptyProjections() });
  assert.ok(!kinds(small.actions).includes('clear-event-log'));
});

test('plan: oversized permission arrays are compacted largest first, huge ones only reported', () => {
  const plan = planStorageMaintenance({
    files: bigFiles(),
    sessions: [
      { id: 'small', bytes: LIMITS.permissionBytes },
      { id: 'mid', bytes: 8 * MiB },
      { id: 'huge', bytes: LIMITS.permissionParseCapBytes + 1 },
      { id: 'big', bytes: 64 * MiB }
    ]
  });
  assert.deepEqual(plan.actions.filter(item => item.kind === 'compact-permissions').map(item => item.sessionID), ['big', 'mid']);
  assert.deepEqual(plan.warnings.filter(item => item.kind === 'permission-unparseable').map(item => item.sessionID), ['huge']);
  assert.equal(plan.actions.at(-1).kind, 'checkpoint', 'writes are followed by a checkpoint');

  const capped = planStorageMaintenance({
    files: bigFiles(),
    sessions: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, bytes: (index + 2) * MiB }))
  }, { limits: { permissionSessions: 3 } });
  assert.deepEqual(capped.actions.filter(item => item.kind === 'compact-permissions').map(item => item.sessionID), ['s9', 's8', 's7']);
});

test('plan: a large WAL alone earns a checkpoint', () => {
  const plan = planStorageMaintenance({ files: bigFiles({ walBytes: LIMITS.inspectWalBytes }) });
  assert.deepEqual(kinds(plan.actions), ['checkpoint']);
});

test('plan: rebuild decisions', () => {
  const now = Date.UTC(2026, 8, 29);
  const base = (overrides = {}) => ({
    files: bigFiles(),
    pageSize: 4096,
    freelistCount: GiB / 4096, // 1 GB free inside a 3 GB file
    autoVacuum: 0,
    tempFreeBytes: 100 * GiB,
    ...overrides
  });

  const full = planStorageMaintenance(base(), { now });
  const vacuum = full.actions.find(item => item.kind === 'vacuum');
  assert.equal(vacuum.mode, 'full');
  assert.equal(vacuum.liveBytes, 2 * GiB);
  assert.equal(vacuum.required, 4 * GiB + LIMITS.vacuumHeadroomBytes);

  // Already incremental: a cheap give-back, allowed even inside a cooldown.
  const incremental = planStorageMaintenance(base({ autoVacuum: 2 }), { now, state: { vacuumFailedAt: now - 1000 } });
  const give = incremental.actions.find(item => item.kind === 'vacuum');
  assert.equal(give.mode, 'incremental');
  assert.equal(give.pages, LIMITS.incrementalPages);

  const cooling = planStorageMaintenance(base(), { now, state: { vacuumFailedAt: now - 1000 } });
  assert.ok(!cooling.actions.some(item => item.kind === 'vacuum'));
  assert.ok(kinds(cooling.warnings).includes('vacuum-cooling'));

  const cooled = planStorageMaintenance(base(), { now, state: { vacuumFailedAt: now - LIMITS.cooldownMs - 1 } });
  assert.equal(cooled.actions.find(item => item.kind === 'vacuum')?.mode, 'full');

  const slow = planStorageMaintenance(base({
    files: bigFiles({ dbBytes: 8 * GiB, totalBytes: 8 * GiB }),
    freelistCount: (2 * GiB) / 4096
  }), { now });
  assert.ok(!slow.actions.some(item => item.kind === 'vacuum'));
  assert.ok(kinds(slow.warnings).includes('vacuum-too-slow'));

  const noDisk = planStorageMaintenance(base({ files: bigFiles({ freeBytes: 4 * GiB }) }), { now });
  assert.ok(!noDisk.actions.some(item => item.kind === 'vacuum'));
  assert.ok(kinds(noDisk.warnings).includes('vacuum-no-space'));

  // The temp volume holds the second copy and counts too.
  const noTemp = planStorageMaintenance(base({ tempFreeBytes: 2 * GiB }), { now });
  assert.ok(kinds(noTemp.warnings).includes('vacuum-no-space'));

  // Not enough reclaimable space to be worth a rebuild.
  const little = planStorageMaintenance(base({ freelistCount: (100 * MiB) / 4096 }), { now });
  assert.ok(!little.actions.some(item => item.kind === 'vacuum'));
  assert.equal(little.skipped, 'within-limits');
});

test('plan: never produces an action that deletes sessions, messages or parts', () => {
  const allowed = new Set(['clear-event-log', 'compact-permissions', 'checkpoint', 'vacuum']);
  const plan = planStorageMaintenance({
    files: bigFiles({ dbBytes: 400 * GiB, totalBytes: 400 * GiB, freeBytes: 1 * GiB }),
    rows: { event: 1e9 },
    projectionTables: emptyProjections(),
    sessions: [{ id: 'a', bytes: 2 * MiB }],
    pageSize: 4096,
    freelistCount: 1
  });
  for (const action of plan.actions) assert.ok(allowed.has(action.kind), action.kind);
  assert.ok(kinds(plan.warnings).includes('database-large'));
  assert.ok(kinds(plan.warnings).includes('disk-low'));
});

test('stepBudget gives the rebuild the long budget and everything else a short one', () => {
  assert.equal(stepBudget('vacuum', 'full'), storage.STEP_BUDGET_MS['vacuum-full']);
  assert.equal(stepBudget('vacuum', 'incremental'), storage.STEP_BUDGET_MS.default);
  assert.equal(stepBudget('clear-event-log'), storage.STEP_BUDGET_MS['clear-event-log']);
  assert.equal(stepBudget('checkpoint'), storage.STEP_BUDGET_MS.default);
});

test('publishedKernelPorts reads endpoint file names only', () => {
  const { dataDir, runtimeRoot } = tempRuntimeRoot();
  assert.deepEqual(publishedKernelPorts(dataDir), []);
  const endpoints = path.join(runtimeRoot, 'endpoints');
  fs.mkdirSync(endpoints, { recursive: true });
  fs.writeFileSync(path.join(endpoints, '4100.json'), '{}');
  fs.writeFileSync(path.join(endpoints, 'notes.txt'), '');
  fs.writeFileSync(path.join(endpoints, 'abc.json'), '{}');
  assert.deepEqual(publishedKernelPorts(dataDir), [4100]);
});

// --- the child process, against a real database ------------------------------

// Small thresholds so a few megabytes of temp database exercise every branch.
const TEST_LIMITS = {
  inspectBytes: 0,
  inspectWalBytes: 1024, // the WAL of a temp database is only a few KB when idle
  warnBytes: 1 * GiB,
  eventRows: 10,
  permissionBytes: 4096,
  permissionParseCapBytes: 64 * MiB,
  permissionSessions: 50,
  vacuumBytes: 1 * MiB,
  vacuumRatio: 0.2,
  vacuumLiveCapBytes: 4 * GiB,
  vacuumHeadroomBytes: 16 * MiB,
  incrementalPages: 65_536,
  diskLowBytes: 0,
  cooldownMs: 24 * 60 * 60 * 1000,
  childTimeoutMs: 60_000
};

function maintenanceOptions(root, overrides = {}) {
  return {
    runtimeRoot: root.runtimeRoot,
    dataDir: root.dataDir,
    limits: TEST_LIMITS,
    ...overrides
  };
}

test('maintenance clears the unused event log, compacts one session and touches nothing else', async () => {
  const root = tempRuntimeRoot();
  const bloated = duplicatedRules(600);
  createDatabase(root.paths.db, {
    events: 4000,
    sessions: [
      { id: 'bloated', permission: bloated },
      { id: 'normal', permission: [{ permission: 'ask', pattern: '*' }] }
    ],
    parts: 200
  });
  const dbBytesBefore = fs.statSync(root.paths.db).size;
  const partBytesBefore = scalar(root.paths.db, 'select sum(length(body)) as value from part');

  const result = await maintainRuntimeStorage(maintenanceOptions(root));

  assert.equal(result.ok, true);
  const actions = result.actions;
  assert.ok(kinds(actions).includes('clear-event-log'), JSON.stringify(result.warnings));
  assert.deepEqual(actions.filter(item => item.kind === 'compact-permissions').map(item => item.sessionID), ['bloated']);
  assert.ok(actions.every(action => action.ok !== false), JSON.stringify(actions));

  assert.equal(rowCount(root.paths.db, 'event'), 0);
  assert.equal(rowCount(root.paths.db, 'event_sequence'), 0);

  // The session's rules still decide exactly what they decided before.
  const stored = JSON.parse(scalar(root.paths.db, "select permission as value from session where id = 'bloated'"));
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map(rule => rule.note), ['round-599', 'round-599', 'round-599']);
  assert.deepEqual(JSON.parse(scalar(root.paths.db, "select permission as value from session where id = 'normal'")), [{ permission: 'ask', pattern: '*' }]);

  // The user's data is exactly where it was.
  assert.equal(rowCount(root.paths.db, 'session'), 2);
  assert.equal(rowCount(root.paths.db, 'part'), 200);
  assert.equal(scalar(root.paths.db, 'select sum(length(body)) as value from part'), partBytesBefore);
  assert.equal(scalar(root.paths.db, 'PRAGMA integrity_check'), 'ok');

  const dbBytesAfter = fs.statSync(root.paths.db).size;
  assert.ok(dbBytesAfter < dbBytesBefore, `${dbBytesAfter} should be smaller than ${dbBytesBefore}`);
  assert.equal(result.before.eventRows, 4000);
  assert.equal(result.after.eventRows, 0);

  const state = readState(root.runtimeRoot);
  assert.ok(state.lastRunAt > 0);
  assert.equal(state.lastOk, true);
});

test('maintenance reports its result to the stability log', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 4000 });
  const entries = [];
  await maintainRuntimeStorage(maintenanceOptions(root, { stabilityLog: { record: (event, fields) => entries.push({ event, ...fields }) } }));
  assert.ok(entries.some(entry => entry.event === 'storage-maintenance'), JSON.stringify(entries));
});

test('a database whose projections hold rows keeps its event log', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 4000, projectionRows: 5 });
  const result = await maintainRuntimeStorage(maintenanceOptions(root));
  assert.equal(rowCount(root.paths.db, 'event'), 4000);
  assert.ok(kinds(result.warnings).includes('event-log-in-use'), JSON.stringify(result.warnings));
});

test('maintenance does nothing at all while another kernel is listening', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 4000, sessions: [{ id: 'bloated', permission: duplicatedRules(600) }] });
  // A live listener on a published endpoint port, as a running kernel leaves it.
  const server = net.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const endpoints = path.join(root.runtimeRoot, 'endpoints');
  fs.mkdirSync(endpoints, { recursive: true });
  fs.writeFileSync(path.join(endpoints, `${port}.json`), '{}');
  try {
    const result = await maintainRuntimeStorage(maintenanceOptions(root));
    assert.equal(result.skipped, 'kernel-running');
    assert.deepEqual(result.actions, []);
    assert.equal(rowCount(root.paths.db, 'event'), 4000);
    const stored = JSON.parse(scalar(root.paths.db, "select permission as value from session where id = 'bloated'"));
    assert.equal(stored.length, 1800, 'the rule array is untouched');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a rebuild hands the free pages back and switches the file to incremental', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { parts: 6000 });
  // A table the app drops wholesale: the free pages a rebuild can reclaim.
  let db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE scratch (id TEXT PRIMARY KEY, body TEXT)');
  const insert = db.prepare('INSERT INTO scratch (id, body) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let index = 0; index < 9000; index += 1) insert.run(`s${index}`, 'y'.repeat(480));
  db.exec('COMMIT');
  db.exec('DROP TABLE scratch');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  const freelistBefore = Number(scalar(root.paths.db, 'PRAGMA freelist_count'));
  const bytesBefore = fs.statSync(root.paths.db).size;
  const partBytes = scalar(root.paths.db, 'select sum(length(body)) as value from part');

  const first = await maintainRuntimeStorage(maintenanceOptions(root));
  const rebuild = first.actions.find(action => action.kind === 'vacuum' && action.mode === 'full');
  assert.ok(rebuild, `expected a rebuild, got ${JSON.stringify(first.actions)} ${JSON.stringify(first.warnings)}`);
  assert.equal(rebuild.ok, true);
  assert.equal(Number(scalar(root.paths.db, 'PRAGMA auto_vacuum')), 2, 'the file is incremental from now on');
  assert.ok(Number(scalar(root.paths.db, 'PRAGMA freelist_count')) < freelistBefore);
  assert.ok(fs.statSync(root.paths.db).size < bytesBefore);
  assert.equal(String(scalar(root.paths.db, 'select * from pragma_journal_mode')).toLowerCase(), 'wal');
  assert.equal(scalar(root.paths.db, 'PRAGMA integrity_check'), 'ok');
  assert.equal(scalar(root.paths.db, 'select sum(length(body)) as value from part'), partBytes);
  assert.equal(rowCount(root.paths.db, 'part'), 6000);
  assert.equal(readState(root.runtimeRoot).vacuumFailedAt, 0, 'a successful rebuild clears the failure mark');

  // Free pages appear again; the second pass gives them back without a rebuild.
  db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE scratch (id TEXT PRIMARY KEY, body TEXT)');
  const insert2 = db.prepare('INSERT INTO scratch (id, body) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let index = 0; index < 6000; index += 1) insert2.run(`s${index}`, 'y'.repeat(480));
  db.exec('COMMIT');
  db.exec('DROP TABLE scratch');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  const second = await maintainRuntimeStorage(maintenanceOptions(root));
  const incremental = second.actions.find(action => action.kind === 'vacuum');
  assert.ok(incremental, `expected a give-back, got ${JSON.stringify(second.actions)} ${JSON.stringify(second.warnings)}`);
  assert.equal(incremental.mode, 'incremental');
  assert.equal(scalar(root.paths.db, 'PRAGMA integrity_check'), 'ok');
  assert.equal(rowCount(root.paths.db, 'part'), 6000);
});

test('a database with nothing wrong is not even opened', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { parts: 10 });
  const result = await maintainRuntimeStorage({
    ...maintenanceOptions(root),
    limits: { ...TEST_LIMITS, inspectBytes: 64 * MiB, inspectWalBytes: 64 * MiB }
  });
  assert.equal(result.skipped, 'within-limits');
  assert.deepEqual(result.actions, []);
  assert.equal(fs.existsSync(storage.statePath(root.runtimeRoot)), false, 'no state file for a no-op');
});

test('a missing database is reported, not created', async () => {
  const root = tempRuntimeRoot();
  const result = await maintainRuntimeStorage(maintenanceOptions(root));
  assert.equal(result.skipped, 'no-database');
  assert.equal(fs.existsSync(root.paths.db), false);
});

test('ensureRuntimeStorage runs one pass per runtime root per process', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 4000 });
  const first = ensureRuntimeStorage(maintenanceOptions(root));
  const second = ensureRuntimeStorage(maintenanceOptions(root));
  assert.equal(first, second, 'the same promise is shared');
  await first;
  assert.equal(rowCount(root.paths.db, 'event'), 0);
  const third = ensureRuntimeStorage(maintenanceOptions(root));
  assert.equal(third, first, 'a later start reuses the finished pass');
});

test('a maintenance child that cannot run still resolves, so a start is never blocked', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 4000 });
  const result = await ensureRuntimeStorage(maintenanceOptions(root, { childScript: path.join(root.dataDir, 'missing-child.js') }));
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.equal(rowCount(root.paths.db, 'event'), 4000, 'nothing was changed');
  assert.equal(readState(root.runtimeRoot).lastOk, false);
});

test('a maintenance child that hangs is killed at its step budget', async () => {
  const root = tempRuntimeRoot();
  const hang = path.join(root.dataDir, 'hang-child.js');
  // Announces a step with the shortest budget, then blocks its event loop.
  fs.writeFileSync(hang, "process.stdout.write(JSON.stringify({ progress: 'action', kind: 'checkpoint' }) + '\\n'); const end = Date.now() + 120000; while (Date.now() < end) {}\n");
  const started = Date.now();
  const budgets = { ...storage.STEP_BUDGET_MS, default: 1500 };
  const result = await storage.runMaintenanceChild({}, { childScript: hang, budgets });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.step, { kind: 'checkpoint', mode: '' });
  assert.ok(elapsed >= budgets.default - 200, `killed too early: ${elapsed} ms`);
  assert.ok(elapsed < budgets.default + 8000, `killed too late: ${elapsed} ms`);
});

test('the runtime monitor warns once, throttles, and never writes', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { parts: 1 });
  const warnings = [];
  const monitor = startStorageMonitor({
    runtimeRoot: root.runtimeRoot,
    limits: { ...TEST_LIMITS, warnBytes: 1, diskLowBytes: Number.MAX_SAFE_INTEGER },
    log: { warn: message => warnings.push(message) },
    stabilityLog: { record: () => {} }
  });
  const dbBytesBefore = fs.statSync(root.paths.db).size;
  try {
    const first = monitor.checkNow();
    assert.deepEqual(kinds(first.warnings).sort(), ['database-large', 'disk-low']);
    assert.ok(first.warnings.find(item => item.kind === 'disk-low').freeBytes > 0);
    assert.equal(warnings.length, 2);
    assert.deepEqual(monitor.checkNow().warnings, [], 'the same warning is not repeated');
    assert.equal(warnings.length, 2);
    assert.equal(fs.statSync(root.paths.db).size, dbBytesBefore, 'the monitor never touches the database');
    monitor.stop();
  } finally {
    monitor.stop();
  }
});

test('large event payloads trigger maintenance below the row limit, with all safety guards', () => {
  const facts = { files: bigFiles(), rows: { event: 21163 }, eventBytes: 1071196117, projectionTables: emptyProjections() };
  assert.ok(kinds(planStorageMaintenance(facts).actions).includes('clear-event-log'));
  assert.deepEqual(planStorageMaintenance(facts, { liveKernel: true }).actions, []);
  for (const projectionTables of [emptyProjections().slice(0, 2), ...[1, null, undefined].map(rows => emptyProjections().map((p, i) => ({ ...p, rows: i === 0 ? rows : 0 })))]) {
    assert.ok(!kinds(planStorageMaintenance({ ...facts, projectionTables }).actions).includes('clear-event-log'));
  }
  assert.ok(!kinds(planStorageMaintenance({ ...facts, eventBytes: LIMITS.eventBytes }).actions).includes('clear-event-log'));
});

test('maintenance measures event bytes and clears few large rows without deleting history', async () => {
  const root = tempRuntimeRoot();
  createDatabase(root.paths.db, { events: 2, parts: 3 });
  const result = await maintainRuntimeStorage(maintenanceOptions(root, { limits: { ...TEST_LIMITS, eventBytes: 512 } }));
  assert.equal(result.ok, true);
  assert.ok(result.before.eventBytes > 512);
  assert.equal(result.before.eventRows, 2);
  assert.equal(result.after.eventBytes, 0);
  assert.equal(rowCount(root.paths.db, 'event'), 0);
  assert.equal(rowCount(root.paths.db, 'part'), 3);
  assert.equal(scalar(root.paths.db, 'PRAGMA integrity_check'), 'ok');
});
