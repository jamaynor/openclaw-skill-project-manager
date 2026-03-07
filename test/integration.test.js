// ---------------------------------------------------------------------------
// test/integration.test.js
//
// Email-triage integration end-to-end test (Item 29).
// Uses node:test and node:assert — no new npm dependencies.
//
// Tests the full workflow:
//   1. Mock child_process.spawn to simulate email-triage --json output
//   2. Create a workspace with a project matching project_hint
//   3. Call addFromEmailTriage() from task.js
//   4. Assert that tasks were created for action-required threads only
// ---------------------------------------------------------------------------

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs     from 'fs';
import path   from 'path';
import os     from 'os';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers (duplicated from test/test.js pattern)
// ---------------------------------------------------------------------------
import {
  saveConfig, globalIndexPath,
} from '../lib/config.js';
import * as create        from '../lib/commands/create.js';
import * as sweep         from '../lib/commands/sweep.js';
import * as projectIndexMd from '../lib/project-index-md.js';
import * as globalIndexMd  from '../lib/global-index-md.js';
import { addFromEmailTriage } from '../lib/commands/task.js';

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-int-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function silent(fn) {
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log   = () => {};
  console.error = () => {};
  console.warn  = () => {};
  try { fn(); } finally {
    console.log   = orig.log;
    console.error = orig.error;
    console.warn  = orig.warn;
  }
}

function makeWorkspaceWithConfig(extraRoots) {
  const ws = makeTmpWorkspace();
  saveConfig(ws, {
    namingConvention: 'yyyy.mm.dd-{location}-{slug}',
    dueSoonDays: 7,
    roots: [
      { name: 'workspace',  type: 'local', path: '{agent-workspace}/projects', location: null },
      { name: 'test-vault', type: 'vault', path: '{agent-workspace}/vault',    location: 'tv' },
      ...(extraRoots || []),
    ],
  });
  return ws;
}

// ---------------------------------------------------------------------------
// Mock spawn factory
//
// Creates a fake spawn function that:
//   - Accepts any command/args
//   - Emits lines via stdout (as EventEmitter)
//   - Closes with code 0
//
// Usage:
//   const mockSpawn = makeMockSpawn([line1, line2, ...]);
//   await addFromEmailTriage(workspace, {}, mockSpawn);
// ---------------------------------------------------------------------------
function makeMockSpawn(lines) {
  return function fakeSpawn(cmd, args, options) {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const proc   = new EventEmitter();
    proc.stdout = stdout;
    proc.stderr = stderr;

    // Emit lines asynchronously so event handlers are registered first
    setImmediate(() => {
      for (const line of lines) {
        stdout.emit('data', Buffer.from(line + '\n'));
      }
      proc.emit('close', 0);
    });

    return proc;
  };
}

// ---------------------------------------------------------------------------
// Fixture: email-triage output
// ---------------------------------------------------------------------------
const ACTION_REQUIRED_THREAD = {
  status:       'action-required',
  subject:      'Follow up on proposal',
  project_hint: '2026.03.07-int-test-project',
  milestone:    'M-1',
};

const NON_ACTION_THREAD = {
  status:       'read',
  subject:      'Newsletter',
  project_hint: '2026.03.07-int-test-project',
  milestone:    'M-1',
};

const UNMATCHED_ACTION_THREAD = {
  status:       'action-required',
  subject:      'Unmatched action',
  project_hint: 'nonexistent-project-xyz',
  milestone:    'M-1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('email-triage integration: addFromEmailTriage', () => {
  let ws, projDir;
  const projectId = '2026.03.07-int-test-project';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, {
      name: 'Int Test Project',
      root: 'workspace',
      date: '2026-03-07',
      due:  '2026-12-31',
      goals: 'Integration test project',
    }));
    projDir = path.join(ws, 'projects', projectId);
    // Add milestone M-1 so tasks can be added
    projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    // Run sweep so the global index is up to date
    silent(() => sweep.run(ws, ws, {}));
  });

  after(() => cleanup(ws));

  test('action-required thread creates a task in the matched project', async () => {
    const mockSpawn = makeMockSpawn([JSON.stringify(ACTION_REQUIRED_THREAD)]);
    const result = await addFromEmailTriage(ws, {}, mockSpawn);

    assert.strictEqual(result.created, 1, 'should create 1 task');

    // Verify the task was actually written to project-index.md
    const data = projectIndexMd.read(projDir);
    const allTasks = data.milestones.flatMap(m => m.tasks);
    const found = allTasks.find(t => t.title === ACTION_REQUIRED_THREAD.subject);
    assert.ok(found, 'task with correct title should exist in project-index.md');
  });

  test('non-action-required thread does not create a task', async () => {
    const tasksBefore = projectIndexMd.read(projDir).milestones.flatMap(m => m.tasks).length;

    const mockSpawn = makeMockSpawn([JSON.stringify(NON_ACTION_THREAD)]);
    const result = await addFromEmailTriage(ws, {}, mockSpawn);

    assert.strictEqual(result.created, 0, 'should not create tasks for non-action-required threads');

    const tasksAfter = projectIndexMd.read(projDir).milestones.flatMap(m => m.tasks).length;
    assert.strictEqual(tasksAfter, tasksBefore, 'task count should be unchanged');
  });

  test('unmatched project_hint skips thread without error', async () => {
    const mockSpawn = makeMockSpawn([JSON.stringify(UNMATCHED_ACTION_THREAD)]);
    const result = await addFromEmailTriage(ws, {}, mockSpawn);

    assert.strictEqual(result.created, 0, 'should create 0 tasks for unmatched hint');
    assert.strictEqual(result.errors,  0, 'should have 0 errors for unmatched hint');
    assert.strictEqual(result.skipped, 1, 'should count 1 skipped for unmatched hint');
  });

  test('mixed fixture: only action-required+matched thread creates task', async () => {
    const tasksBefore = projectIndexMd.read(projDir).milestones.flatMap(m => m.tasks).length;

    const mockSpawn = makeMockSpawn([
      JSON.stringify(NON_ACTION_THREAD),
      JSON.stringify(UNMATCHED_ACTION_THREAD),
      JSON.stringify({ ...ACTION_REQUIRED_THREAD, subject: 'Mixed Test Task' }),
    ]);
    const result = await addFromEmailTriage(ws, {}, mockSpawn);

    assert.strictEqual(result.created, 1, 'exactly 1 task should be created from the mixed fixture');

    const data = projectIndexMd.read(projDir);
    const allTasks = data.milestones.flatMap(m => m.tasks);
    const found = allTasks.find(t => t.title === 'Mixed Test Task');
    assert.ok(found, 'task "Mixed Test Task" should exist in project-index.md');
  });
});
