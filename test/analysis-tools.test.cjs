'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { extractOutline, findSymbol, detectLanguage } = require('../lib/analysis/outline');
const { buildRepoMap, rankNodes, buildFileGraph } = require('../lib/analysis/repo-map');
const { buildCallIndex, queryCallTree } = require('../lib/analysis/calltree');
const { createBm25Index, tokenize } = require('../lib/analysis/bm25');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-analysis-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('outline extracts JS classes, methods, functions and arrows with ranges', () => {
  const source = [
    'import { helper } from "./b.js";',
    '',
    'export class Engine {',
    '  constructor(size) {',
    '    this.size = size;',
    '  }',
    '  start(mode) {',
    '    return helper(mode);',
    '  }',
    '  get speed() { return this.size; }',
    '}',
    '',
    'export async function ignite(name) {',
    '  return name;',
    '}',
    '',
    'const quench = (heat) => {',
    '  return heat - 1;',
    '};'
  ].join('\n');
  const outline = extractOutline('app/engine.js', source);
  assert.equal(outline.language, 'js');
  const names = outline.symbols.map(symbol => symbol.name);
  assert.ok(names.includes('Engine'));
  assert.ok(names.includes('Engine.start'), `methods qualified: ${names.join(',')}`);
  assert.ok(names.includes('ignite'));
  assert.ok(names.includes('quench'));
  const engine = findSymbol(outline.symbols, 'Engine');
  assert.equal(engine.line, 3);
  const start = findSymbol(outline.symbols, 'start');
  assert.equal(start.line, 7);
  assert.equal(start.endLine, 9);
  const ignite = findSymbol(outline.symbols, 'ignite');
  assert.equal(ignite.endLine, 15);
});

test('outline handles python indentation', () => {
  const source = [
    'class Parser:',
    '    def __init__(self):',
    '        self.rows = []',
    '',
    '    def parse(self, data):',
    '        return self.rows',
    '',
    'def load(path):',
    '    return Parser()'
  ].join('\n');
  const outline = extractOutline('tools/parser.py', source);
  assert.equal(outline.language, 'python');
  const names = outline.symbols.map(symbol => symbol.name);
  assert.ok(names.includes('Parser'));
  assert.ok(names.includes('Parser.parse'));
  assert.ok(names.includes('load'));
  const parse = findSymbol(outline.symbols, 'parse');
  assert.equal(parse.line, 5);
  assert.equal(parse.endLine, 6);
});

test('repo map ranks the most-imported module first and respects the budget', () => {
  const root = makeTempRoot();
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  write(path.join(root, 'src', 'core.js'), 'export function core() { return 1; }\nexport function coreTwo() { return 2; }\n');
  write(path.join(root, 'src', 'a.js'), 'import { core } from "./core.js";\nexport function aThing() { return core(); }\n');
  write(path.join(root, 'src', 'b.js'), 'import { core } from "./core.js";\nexport function bThing() { return core(); }\n');
  write(path.join(root, 'src', 'leaf.js'), 'export function leaf() { return 3; }\n');

  const nodes = buildFileGraph(root);
  const coreFile = path.normalize(path.join(root, 'src', 'core.js')).toLowerCase();
  assert.ok(nodes.get(coreFile), 'core.js is in the graph');
  assert.equal(nodes.get(coreFile).deps.length, 0);
  const rank = rankNodes(nodes);
  const leafFile = path.normalize(path.join(root, 'src', 'leaf.js')).toLowerCase();
  assert.ok(rank.get(coreFile) > rank.get(leafFile), 'imported core outranks a leaf');

  const map = buildRepoMap(root, { budgetTokens: 400 });
  assert.ok(map.text.includes('src/core.js'));
  assert.ok(map.text.includes('core, coreTwo'));
  assert.ok(map.files >= 4);

  const tiny = buildRepoMap(root, { budgetTokens: 40 });
  assert.equal(tiny.truncated, true);
  cleanup();
});

test('calltree resolves cross-file calls, prunes noise and marks unresolved', () => {
  const root = makeTempRoot();
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  write(path.join(root, 'lib', 'net.js'), [
    'export function encode(frame) {',
    '  return frame.length;',
    '}',
    'export function getHeader(frame) {',
    '  return frame[0];',
    '}'
  ].join('\n'));
  write(path.join(root, 'app.js'), [
    'import { encode } from "./lib/net.js";',
    '',
    'export function dispatch(frame) {',
    '  const size = encode(frame);',
    '  const header = getHeader(frame);',
    '  return mysteriousHelper(size, header);',
    '}'
  ].join('\n'));

  const index = buildCallIndex(root);
  const result = queryCallTree(index, 'dispatch', { depth: 4 });
  assert.ok(result.nodes > 0);
  assert.match(result.text, /encode  \(.*lib[/\\]net\.js:\d+\)/, 'cross-file callee resolved');
  assert.match(result.text, /getHeader \[pruned|getHeader \[/, 'noise kept visible but marked or pruned');
  assert.match(result.text, /mysteriousHelper \[unresolved\]/);
  cleanup();
});

test('bm25 ranks relevant documents first and handles CJK bigrams', () => {
  const index = createBm25Index();
  index.add('git', 'repository status parsing and git diff statistics', { path: 'git.js' });
  index.add('net', 'network protocol encoder for frame headers', { path: 'net.js' });
  index.add('cn1', '协议状态机推断与字段对齐', { path: 'notes.md' });
  index.add('cn2', '渲染管线与界面动画', { path: 'ui.md' });

  const hits = index.search('git diff statistics');
  assert.equal(hits[0].id, 'git');
  const cjkHits = index.search('状态机');
  assert.equal(cjkHits[0].id, 'cn1');
  assert.ok(index.search('protocol frame').length >= 1);
  index.remove('git');
  assert.equal(index.size, 3);
  assert.deepEqual(tokenize('协议状态'), ['协议', '议状', '状态']);
});
