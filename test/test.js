'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function assertEqual(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const { slugify, buildProjectId, resolveWorkspace, configPath, indexPath } = require('../lib/config');

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
console.log('\nslugify');
assertEqual('lowercases',             slugify('Hello World'),        'hello-world');
assertEqual('collapses spaces',       slugify('  foo   bar  '),      'foo-bar');
assertEqual('strips leading dashes',  slugify('--foo'),              'foo');
assertEqual('strips trailing dashes', slugify('foo--'),              'foo');
assertEqual('handles special chars',  slugify('Sales/Pipeline v2!'), 'sales-pipeline-v2');

// ---------------------------------------------------------------------------
// buildProjectId
// ---------------------------------------------------------------------------
console.log('\nbuildProjectId');

const localRoot = { type: 'local', location: null };
const vaultRoot = { type: 'vault', location: 'lmb' };
const testDate  = new Date(2026, 1, 24); // Feb 24 2026 — local, no UTC shift

assertEqual('local root — no location',
  buildProjectId(localRoot, 'Internal Tool', testDate),
  '2026.02.24-internal-tool');

assertEqual('vault root — includes location',
  buildProjectId(vaultRoot, 'Sales Pipeline', testDate),
  '2026.02.24-lmb-sales-pipeline');

// ---------------------------------------------------------------------------
// resolveWorkspace
// ---------------------------------------------------------------------------
console.log('\nresolveWorkspace');

const origEnv = process.env.PROJECT_AGENT_WORKSPACE;
delete process.env.PROJECT_AGENT_WORKSPACE;

assertEqual('no args, no env → cwd',
  resolveWorkspace([]),
  process.cwd());

process.env.PROJECT_AGENT_WORKSPACE = '/tmp/my-workspace';
assertEqual('env var used when no flag',
  resolveWorkspace([]),
  path.resolve('/tmp/my-workspace'));

assertEqual('--workspace flag overrides env',
  resolveWorkspace(['--workspace', '/tmp/override']),
  path.resolve('/tmp/override'));

if (origEnv !== undefined) process.env.PROJECT_AGENT_WORKSPACE = origEnv;
else delete process.env.PROJECT_AGENT_WORKSPACE;

// ---------------------------------------------------------------------------
// configPath / indexPath
// ---------------------------------------------------------------------------
console.log('\nconfigPath / indexPath');

assertEqual('configPath',
  configPath('/ws'),
  path.join('/ws', 'config', 'project-manager.json'));

assertEqual('indexPath',
  indexPath('/ws'),
  path.join('/ws', 'projects', 'projects-index.json'));

// ---------------------------------------------------------------------------
// create command — integration smoke test
// ---------------------------------------------------------------------------
console.log('\ncreate (integration)');

const { saveConfig } = require('../lib/config');
const create = require('../lib/commands/create');

const ws = makeTmpWorkspace();
try {
  const config = {
    namingConvention: 'yyyy.mm.dd-{location}-{slug}',
    roots: [
      { name: 'workspace', type: 'local',  path: '{agent-workspace}/projects', location: null },
      { name: 'test-vault', type: 'vault', path: '{agent-workspace}/vault',    location: 'tv' },
    ],
  };
  saveConfig(ws, config);

  // Capture stdout/stderr
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log   = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try {
    create.run(ws, ['--name', 'Test Project', '--root', 'workspace', '--date', '2026-02-24']);
  } finally {
    console.log   = orig.log;
    console.error = orig.error;
  }

  const id      = '2026.02.24-test-project';
  const projDir = path.join(ws, 'projects', id);

  assert('project directory created',         fs.existsSync(projDir));
  assert('README.md seeded',                  fs.existsSync(path.join(projDir, 'README.md')));

  const idx = JSON.parse(fs.readFileSync(indexPath(ws), 'utf8'));
  assertEqual('one entry in index',           idx.projects.length, 1);
  assertEqual('index entry id',               idx.projects[0].id, id);
  assertEqual('index entry status',           idx.projects[0].status, 'active');
  assertEqual('index startDate no UTC shift', idx.projects[0].startDate, '2026-02-24');

  // Duplicate should fail
  let exitCode = null;
  const origExit  = process.exit;
  const origError = console.error;
  process.exit  = (code) => { exitCode = code; throw new Error('exit'); };
  console.error = () => {};
  try {
    create.run(ws, ['--name', 'Test Project', '--root', 'workspace', '--date', '2026-02-24']);
  } catch (e) {
    if (e.message !== 'exit') throw e;
  } finally {
    process.exit  = origExit;
    console.error = origError;
  }
  assertEqual('duplicate id rejected (exit 1)', exitCode, 1);

} finally {
  cleanup(ws);
}

// ---------------------------------------------------------------------------
// create — validation edge cases
// ---------------------------------------------------------------------------
console.log('\ncreate (validation)');

{
  const ws2 = makeTmpWorkspace();
  try {
    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    };
    saveConfig(ws2, config);

    // Helper: run create, expect process.exit(1), return captured stderr
    function expectFailure(label, args) {
      let exitCode = null;
      const errors = [];
      const origExit  = process.exit;
      const origError = console.error;
      process.exit    = (code) => { exitCode = code; throw new Error('exit'); };
      console.error   = (...a) => errors.push(a.join(' '));
      try {
        create.run(ws2, args);
      } catch (e) {
        if (e.message !== 'exit') throw e;
      } finally {
        process.exit  = origExit;
        console.error = origError;
      }
      assertEqual(label, exitCode, 1);
      return errors;
    }

    expectFailure('whitespace-only --name rejected',
      ['--name', '   ', '--root', 'workspace']);

    expectFailure('invalid date format rejected',
      ['--name', 'Valid Name', '--root', 'workspace', '--date', 'not-a-date']);

    expectFailure('bad date like 2026/02/24 rejected',
      ['--name', 'Valid Name', '--root', 'workspace', '--date', '2026/02/24']);

    expectFailure('semantically invalid date rejected (Feb 31)',
      ['--name', 'Valid Name', '--root', 'workspace', '--date', '2026-02-31']);

  } finally {
    cleanup(ws2);
  }
}

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------
console.log('\nlist');

{
  const list = require('../lib/commands/list');
  const ws3 = makeTmpWorkspace();
  try {
    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    };
    saveConfig(ws3, config);

    // Create two projects
    const silencedLogs = [];
    const orig = { log: console.log, error: console.error };
    console.log   = (...a) => silencedLogs.push(a.join(' '));
    console.error = (...a) => silencedLogs.push(a.join(' '));
    try {
      create.run(ws3, ['--name', 'Alpha', '--root', 'workspace', '--date', '2026-02-24']);
      create.run(ws3, ['--name', 'Beta',  '--root', 'workspace', '--date', '2026-02-25']);
    } finally {
      console.log   = orig.log;
      console.error = orig.error;
    }

    // Capture list output
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      list.run(ws3, []);
    } finally {
      console.log = origLog;
    }

    const output = lines.join('\n');
    assert('list shows both projects', output.includes('2026.02.24-alpha') && output.includes('2026.02.25-beta'));
    assert('list shows ACTIVE header',  output.includes('ACTIVE'));

    // Filter by status with no matches
    const noLines = [];
    const origLog2 = console.log;
    console.log = (...a) => noLines.push(a.join(' '));
    try {
      list.run(ws3, ['--status', 'completed']);
    } finally {
      console.log = origLog2;
    }
    assert('list --status completed shows none', noLines.join('\n').includes('No projects found'));

  } finally {
    cleanup(ws3);
  }
}

// ---------------------------------------------------------------------------
// status command (complete / archive)
// ---------------------------------------------------------------------------
console.log('\nstatus');

{
  const statusCmd = require('../lib/commands/status');
  const ws4 = makeTmpWorkspace();
  try {
    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    };
    saveConfig(ws4, config);

    const silenced = [];
    const orig = { log: console.log, error: console.error };
    console.log   = (...a) => silenced.push(a.join(' '));
    console.error = (...a) => silenced.push(a.join(' '));
    try {
      create.run(ws4, ['--name', 'My Task', '--root', 'workspace', '--date', '2026-02-24']);
    } finally {
      console.log   = orig.log;
      console.error = orig.error;
    }

    const id = '2026.02.24-my-task';

    function silentStatus(args, newStatus) {
      const sink = [];
      const origLog = console.log;
      console.log = (...a) => sink.push(a.join(' '));
      try { statusCmd.run(ws4, args, newStatus); }
      finally { console.log = origLog; }
    }

    // Complete it
    silentStatus(['--id', id], 'completed');
    const idx1 = JSON.parse(fs.readFileSync(indexPath(ws4), 'utf8'));
    assertEqual('status set to completed',          idx1.projects[0].status, 'completed');
    assert(     'completionDate set',               !!idx1.projects[0].completionDate);
    assert(     'archivedDate still null',          idx1.projects[0].archivedDate === null);

    // Re-completing should warn, not overwrite
    const origDate = idx1.projects[0].completionDate;
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      silentStatus(['--id', id], 'completed');
    } finally {
      console.warn = origWarn;
    }
    assert('re-complete emits warning',             warns.some(w => w.includes('already completed')));
    const idx2 = JSON.parse(fs.readFileSync(indexPath(ws4), 'utf8'));
    assertEqual('completionDate not overwritten',   idx2.projects[0].completionDate, origDate);

    // Archive it
    silentStatus(['--id', id], 'archived');
    const idx3 = JSON.parse(fs.readFileSync(indexPath(ws4), 'utf8'));
    assertEqual('status set to archived',           idx3.projects[0].status, 'archived');
    assert(     'archivedDate set',                 !!idx3.projects[0].archivedDate);

  } finally {
    cleanup(ws4);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
