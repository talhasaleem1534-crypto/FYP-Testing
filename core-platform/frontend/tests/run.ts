// Run with: npm test   (bundled by esbuild, no extra dependencies)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classify, countByLevel, firstError, groupLines, parseLogs, pipelineStages, splitHighlight, toPlainText } from '../src/lib/logs';

const load = (n: string) => JSON.parse(readFileSync(resolve(process.cwd(), 'tests', 'fixtures', `${n}.json`), 'utf8'));
const ok = load('deploy_success'), bad = load('deploy_failed');
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };

test('a raw entry with embedded newlines becomes separate lines and timestamps are split off', () => {
  const lines = parseLogs(['[5:34:29 PM] \n📦 STEP 1/4 — Fetching repository...', '[5:34:30 PM]   Step 3/8 : RUN npm install']);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].time, '5:34:29 PM');
  assert.equal(lines[0].level, 'step');
  assert.equal(lines[1].level, 'dim');                       // docker's own "Step 3/8" must not be a pipeline step
});

test('successful deployment: app URL line is detected with its URL', () => {
  const lines = parseLogs(ok.logs);
  const u = lines.find(l => l.isAppUrl)!;
  assert.ok(u, 'no App URL line found');
  assert.equal(u.urls[0], ok.app_url);
  assert.equal(u.level, 'success');
  assert.equal(countByLevel(lines).error, 0);
});

test('successful deployment: four pipeline stages, all done; groups are done', () => {
  const lines = parseLogs(ok.logs);
  const stages = pipelineStages(lines, 'success');
  assert.deepEqual(stages.map(s => s.state), ['done', 'done', 'done', 'done']);
  const groups = groupLines(lines, true, false);
  assert.ok(groups.length >= 4);
  assert.ok(groups.every(g => g.status === 'done'));
});

test('failed deployment: error found, stage 4 marked failed, rollback is not an error', () => {
  const lines = parseLogs(bad.logs);
  const err = firstError(lines)!;
  assert.ok(err && /not healthy|exited/i.test(err.text), err?.text);
  const stages = pipelineStages(lines, 'failed');
  assert.deepEqual(stages.map(s => s.state), ['done', 'done', 'done', 'failed']);
  const rolled = lines.find(l => /Rolled back/.test(l.text))!;
  assert.equal(rolled.level, 'success');
  assert.ok(groupLines(lines, true, true).some(g => g.status === 'failed'));
});

test('decoration lines are dividers, never errors/steps', () => {
  const lines = parseLogs(['[1:00:00 PM] ❌ ══════════════════════════════════════════════', '[1:00:00 PM] 🚀 ═══════════════════════════════════════']);
  assert.ok(lines.every(l => l.divider && l.level === 'dim'));
});

test('live (unfinished) pipeline: current stage is active, later ones pending', () => {
  const lines = parseLogs(ok.logs.slice(0, 14));
  const states = pipelineStages(lines, 'building').map(s => s.state);
  assert.ok(states.includes('active') && states.includes('pending'), states.join());
});

test('classifier basics', () => {
  assert.equal(classify('npm WARN deprecated foo', true), 'warn');
  assert.equal(classify('Error: listen EADDRINUSE', false), 'error');
  assert.equal(classify('0 failed, 5 passed', false), 'info');
  assert.equal(classify('✅ Image built successfully', false), 'success');
  assert.equal(classify('Cloning into .', false), 'info');
});

test("docker's own indented 'Step 3/4' is not a pipeline step", () => {
  const lines = parseLogs(['[1:00:00 PM] 🔨 STEP 3/4 — Building Docker image', '[1:00:01 PM]   Step 3/4 : RUN npm install', '[1:00:02 PM]   Step 4/4 : CMD ["node"]']);
  assert.deepEqual(pipelineStages(lines, 'building').map(s => s.state), ['done', 'done', 'active', 'pending']);
  assert.equal(groupLines(lines, false, false).length, 1);
});

test('search highlight and plain-text export', () => {
  assert.deepEqual(splitHighlight('Hello World hello', 'hello').map(p => p.hit), [true, false, true]);
  assert.deepEqual(splitHighlight('abc', ''), [{ text: 'abc', hit: false }]);
  assert.ok(!toPlainText(ok.logs).includes('\n\n'));
});

console.log(`\n${passed} tests passed`);
