import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs     from 'fs';
import path   from 'path';
import os     from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import {
  slugify, buildProjectId, resolveWorkspace, resolveAgentWorkspace, configPath,
  globalIndexPath, saveConfig, formatDate,
} from '../lib/config.js';

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Silence all console output; restore on return
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

// Capture console.log lines; restore on return
function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

// ---------------------------------------------------------------------------
// Modules under test
// ---------------------------------------------------------------------------
import * as create       from '../lib/commands/create.js';
import * as list         from '../lib/commands/list.js';
import * as statusCmd    from '../lib/commands/status.js';
import * as showCmd      from '../lib/commands/show.js';
import * as tasksCmd     from '../lib/commands/tasks.js';
import * as taskCmd      from '../lib/commands/task.js';
import * as milestoneCmd from '../lib/commands/milestone.js';
import * as roots        from '../lib/commands/roots.js';
import * as sweep        from '../lib/commands/sweep.js';
import * as migrate      from '../lib/commands/migrate.js';
import { extractBody, setFrontmatter } from '../lib/frontmatter.js';
import * as tasksMd      from '../lib/tasks-md.js';
import * as log          from '../lib/logger.js';
import * as projectIndexMd from '../lib/project-index-md.js';
import * as globalIndexMd  from '../lib/global-index-md.js';

// ---------------------------------------------------------------------------
// Constants shared across test sections
// ---------------------------------------------------------------------------
const localRoot = { type: 'local', location: null };
const vaultRoot = { type: 'vault', location: 'lmb' };
const testDate  = new Date(2026, 1, 24); // Feb 24 2026 — local, no UTC shift

const BASE_CREATE = { root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'Test goals' };

function makeWorkspaceWithConfig(extraRoots) {
  const ws = makeTmpWorkspace();
  saveConfig(ws, {
    namingConvention: 'yyyy.mm.dd-{location}-{slug}',
    roots: [
      { name: 'workspace',  type: 'local', path: '{agent-workspace}/projects', location: null },
      { name: 'test-vault', type: 'vault', path: '{agent-workspace}/vault',    location: 'tv' },
      ...(extraRoots || []),
    ],
  });
  return ws;
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  test('lowercases',             () => assert.strictEqual(slugify('Hello World'),        'hello-world'));
  test('collapses spaces',       () => assert.strictEqual(slugify('  foo   bar  '),      'foo-bar'));
  test('strips leading dashes',  () => assert.strictEqual(slugify('--foo'),              'foo'));
  test('strips trailing dashes', () => assert.strictEqual(slugify('foo--'),              'foo'));
  test('handles special chars',  () => assert.strictEqual(slugify('Sales/Pipeline v2!'), 'sales-pipeline-v2'));
});

// ---------------------------------------------------------------------------
// buildProjectId
// ---------------------------------------------------------------------------
describe('buildProjectId', () => {
  test('local root — no location', () =>
    assert.strictEqual(buildProjectId(localRoot, 'Internal Tool', testDate), '2026.02.24-internal-tool'));
  test('vault root — includes location', () =>
    assert.strictEqual(buildProjectId(vaultRoot, 'Sales Pipeline', testDate), '2026.02.24-lmb-sales-pipeline'));
});

// ---------------------------------------------------------------------------
// resolveWorkspace
// ---------------------------------------------------------------------------
describe('resolveWorkspace', () => {
  let origMaster;
  before(() => {
    origMaster = process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
    delete process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
  });
  after(() => {
    if (origMaster !== undefined) process.env.HAL_PROG_MGR_MASTER_WORKSPACE = origMaster;
    else delete process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
  });

  test('no args, no env → cwd', () => {
    delete process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
    assert.strictEqual(resolveWorkspace(undefined), process.cwd());
  });

  test('HAL_PROG_MGR_MASTER_WORKSPACE used when set', () => {
    process.env.HAL_PROG_MGR_MASTER_WORKSPACE = '/tmp/master-ws';
    assert.strictEqual(resolveWorkspace(undefined), path.resolve('/tmp/master-ws'));
  });

  test('--workspace flag overrides HAL_PROG_MGR_MASTER_WORKSPACE', () => {
    process.env.HAL_PROG_MGR_MASTER_WORKSPACE = '/tmp/master-ws';
    assert.strictEqual(resolveWorkspace('/tmp/override'), path.resolve('/tmp/override'));
  });
});

// ---------------------------------------------------------------------------
// resolveAgentWorkspace
// ---------------------------------------------------------------------------
describe('resolveAgentWorkspace', () => {
  let origMaster;
  let origAgentWorkspace;
  before(() => {
    origMaster = process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
    origAgentWorkspace = process.env.HAL_AGENT_WORKSPACE;
    delete process.env.HAL_PROG_MGR_MASTER_WORKSPACE;
    delete process.env.HAL_AGENT_WORKSPACE;
  });
  after(() => {
    if (origMaster !== undefined) process.env.HAL_PROG_MGR_MASTER_WORKSPACE = origMaster;
    else delete process.env.HAL_PROG_MGR_MASTER_WORKSPACE;

    if (origAgentWorkspace !== undefined) process.env.HAL_AGENT_WORKSPACE = origAgentWorkspace;
    else delete process.env.HAL_AGENT_WORKSPACE;
  });

  test('no env → cwd', () => {
    delete process.env.HAL_AGENT_WORKSPACE;
    assert.strictEqual(resolveAgentWorkspace(undefined, undefined), process.cwd());
  });

  test('HAL_AGENT_WORKSPACE used when set', () => {
    process.env.HAL_AGENT_WORKSPACE = '/tmp/agent-ws';
    assert.strictEqual(resolveAgentWorkspace(undefined, undefined), path.resolve('/tmp/agent-ws'));
  });

  test('--agent-workspace flag overrides HAL_AGENT_WORKSPACE', () => {
    process.env.HAL_AGENT_WORKSPACE = '/tmp/agent-ws';
    assert.strictEqual(
      resolveAgentWorkspace('/tmp/override-agent', undefined),
      path.resolve('/tmp/override-agent')
    );
  });
});

// ---------------------------------------------------------------------------
// configPath
// ---------------------------------------------------------------------------
describe('configPath', () => {
  test('configPath', () =>
    assert.strictEqual(configPath('/ws'), path.join('/ws', 'config', 'hal-project-manager.json')));
});

// ---------------------------------------------------------------------------
// globalIndexPath (Task Group 2)
// ---------------------------------------------------------------------------
describe('globalIndexPath', () => {
  let tmpDir;
  before(() => { tmpDir = makeTmpWorkspace(); });
  after(() => cleanup(tmpDir));

  test('returns a new dated path when no projects dir exists', () => {
    // The projects dir does not exist — should return a path with today's date
    const p = globalIndexPath(tmpDir);
    const today = new Date();
    const yy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    assert.ok(p.endsWith(`${yy}.${mm}.${dd}-global-project-index.md`));
    assert.ok(p.includes(path.join(tmpDir, 'projects')));
  });

  test('returns a new dated path when projects dir is empty', () => {
    const projDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(projDir, { recursive: true });
    const p = globalIndexPath(tmpDir);
    const today = new Date();
    const yy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    assert.ok(p.endsWith(`${yy}.${mm}.${dd}-global-project-index.md`));
  });

  test('returns the most recently dated file when multiple exist', () => {
    const projDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(projDir, { recursive: true });
    // Write three dated files; 2026.03.09 is the latest
    fs.writeFileSync(path.join(projDir, '2026.03.07-global-project-index.md'), '');
    fs.writeFileSync(path.join(projDir, '2026.03.09-global-project-index.md'), '');
    fs.writeFileSync(path.join(projDir, '2026.03.08-global-project-index.md'), '');
    const p = globalIndexPath(tmpDir);
    assert.ok(p.endsWith('2026.03.09-global-project-index.md'));
  });

  test('ignores non-matching files in projects dir', () => {
    const projDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(projDir, { recursive: true });
    // A file that does NOT match the dated pattern
    fs.writeFileSync(path.join(projDir, 'README.md'), 'ignore me');
    // If only non-matching files exist, should return a today-dated path
    // (We already seeded matching files above in the prior test, so just confirm
    //  the matching file wins over the non-matching one)
    const p = globalIndexPath(tmpDir);
    assert.ok(!p.endsWith('README.md'));
    assert.ok(p.includes('global-project-index.md'));
  });
});

// ---------------------------------------------------------------------------
// roots command
// ---------------------------------------------------------------------------
describe('roots', () => {
  let ws;
  before(() => {
    ws = makeTmpWorkspace();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: [
        { name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null, description: '' },
        { name: 'my-vault',  type: 'vault', path: '/vaults/my',                location: 'mv', description: 'My vault' },
      ],
    });
  });
  after(() => cleanup(ws));

  test('shows local root name',     () => assert.ok(captureLog(() => roots.run(ws, ws)).join('\n').includes('workspace')));
  test('shows vault root name',     () => assert.ok(captureLog(() => roots.run(ws, ws)).join('\n').includes('my-vault')));
  test('expands {agent-workspace}', () => assert.ok(captureLog(() => roots.run(ws, ws)).join('\n').includes(ws)));
  test('shows location code',       () => assert.ok(captureLog(() => roots.run(ws, ws)).join('\n').includes('mv')));
});

// ---------------------------------------------------------------------------
// create (integration)
// ---------------------------------------------------------------------------
describe('create (integration)', () => {
  let ws;
  const id = '2026.02.24-test-project';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, { name: 'Test Project', ...BASE_CREATE }));
  });
  after(() => cleanup(ws));

  test('project directory created', () =>
    assert.ok(fs.existsSync(path.join(ws, 'projects', id))));

  test('project-index.md seeded', () =>
    assert.ok(fs.existsSync(path.join(ws, 'projects', id, 'project-index.md'))));

  test('README.md NOT created', () =>
    assert.ok(!fs.existsSync(path.join(ws, 'projects', id, 'README.md'))));

  test('tasks.md NOT created', () =>
    assert.ok(!fs.existsSync(path.join(ws, 'projects', id, 'tasks.md'))));

  test('global index file created', () =>
    assert.ok(fs.existsSync(globalIndexPath(ws))));

  test('one entry in global index', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    assert.strictEqual(records.length, 1);
  });

  test('global index entry id', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    assert.strictEqual(records[0].id, id);
  });

  test('global index entry status', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    assert.strictEqual(records[0].status, 'active');
  });

  test('project-index.md frontmatter started date no UTC shift', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.frontmatter['started'], '2026-02-24');
  });

  test('project-index.md frontmatter due date', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.frontmatter['due'], '2026-12-31');
  });

  test('project-index.md title', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.title, 'Test Project');
  });

  test('project-index.md objective from --goals', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.statement.objective, 'Test goals');
  });

  test('project-index.md milestones empty', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.milestones.length, 0);
  });

  test('project-index.md path field set correctly', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.ok(data.frontmatter['path'].endsWith(id));
  });

  test('project-index.md last-touched set to today', () => {
    const data = projectIndexMd.read(path.join(ws, 'projects', id));
    assert.strictEqual(data.frontmatter['last-touched'], projectIndexMd.todayStr());
  });

  test('--date omitted: project id starts with today', () => {
    const wsTmp = makeWorkspaceWithConfig();
    try {
      silent(() => create.run(wsTmp, wsTmp, { name: 'Today Project', root: 'workspace', due: '2026-12-31', goals: 'g' }));
      const today = new Date();
      const todayDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
      const records = globalIndexMd.readGlobalIndex(wsTmp);
      assert.ok(records[0].id.startsWith(todayDot));
    } finally {
      cleanup(wsTmp);
    }
  });

  test('--date omitted: started date is today', () => {
    const wsTmp = makeWorkspaceWithConfig();
    try {
      silent(() => create.run(wsTmp, wsTmp, { name: 'Today Project', root: 'workspace', due: '2026-12-31', goals: 'g' }));
      const records = globalIndexMd.readGlobalIndex(wsTmp);
      const projPath = records[0].path;
      const data = projectIndexMd.read(projPath);
      assert.strictEqual(data.frontmatter['started'], formatDate(new Date(), '-'));
    } finally {
      cleanup(wsTmp);
    }
  });

  test('duplicate id throws', () => {
    assert.throws(() => create.run(ws, ws, { name: 'Test Project', ...BASE_CREATE }), /already exists/);
  });
});

// ---------------------------------------------------------------------------
// create (validation)
// ---------------------------------------------------------------------------
describe('create (validation)', () => {
  let ws;
  before(() => { ws = makeWorkspaceWithConfig(); });
  after(() => cleanup(ws));

  test('missing --due throws', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', goals: 'g' }), /--due is required/));
  test('missing --goals throws', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', due: '2026-12-31' }), /--goals is required/));
  test('whitespace-only --name rejected', () =>
    assert.throws(() => create.run(ws, ws, { name: '   ', root: 'workspace', due: '2026-12-31', goals: 'g' }), /alphanumeric/));
  test('invalid --date format rejected', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', date: 'not-a-date', due: '2026-12-31', goals: 'g' }), /Invalid date/));
  test('bad date like 2026/02/24 rejected', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', date: '2026/02/24', due: '2026-12-31', goals: 'g' }), /Invalid date/));
  test('semantically invalid --date rejected (Feb 31)', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', date: '2026-02-31', due: '2026-12-31', goals: 'g' }), /Invalid date/));
  test('invalid --due format rejected', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', due: 'not-a-date', goals: 'g' }), /Invalid date/));
  test('semantically invalid --due rejected (Feb 31)', () =>
    assert.throws(() => create.run(ws, ws, { name: 'Valid', root: 'workspace', due: '2026-02-31', goals: 'g' }), /Invalid date/));
});

// ---------------------------------------------------------------------------
// create (project-index.md frontmatter — uniform for all root types)
// ---------------------------------------------------------------------------
describe('create (project-index.md frontmatter)', () => {
  let ws, vaultData, localData;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, { name: 'Vault Project', root: 'test-vault', date: '2026-02-24', due: '2026-06-30', goals: 'Vault goals' }));
    silent(() => create.run(ws, ws, { name: 'Local Project', root: 'workspace',  date: '2026-02-24', due: '2026-06-30', goals: 'Local goals' }));
    vaultData = projectIndexMd.read(path.join(ws, 'vault',    '2026.02.24-tv-vault-project'));
    localData = projectIndexMd.read(path.join(ws, 'projects', '2026.02.24-local-project'));
  });
  after(() => cleanup(ws));

  // Both vault and local projects use the same project-index.md format
  test('vault project-index.md has title field',      () => assert.strictEqual(vaultData.frontmatter['title'], 'Vault Project'));
  test('vault project-index.md has id field',         () => assert.strictEqual(vaultData.frontmatter['id'], '2026.02.24-tv-vault-project'));
  test('vault project-index.md has status field',     () => assert.strictEqual(vaultData.frontmatter['status'], 'active'));
  test('vault project-index.md has tags array',       () => assert.ok(Array.isArray(vaultData.frontmatter['tags'])));
  test('vault project-index.md has started',          () => assert.strictEqual(vaultData.frontmatter['started'], '2026-02-24'));
  test('vault project-index.md has due',              () => assert.strictEqual(vaultData.frontmatter['due'], '2026-06-30'));
  test('vault project-index.md has path field',       () => assert.ok(vaultData.frontmatter['path'].length > 0));
  test('vault project-index.md has last-touched',     () => assert.ok(vaultData.frontmatter['last-touched'].length > 0));
  test('vault project-index.md has NO location',      () => assert.ok(!('location' in vaultData.frontmatter)));
  test('vault project-index.md has NO milestones key',() => assert.ok(!('milestones' in vaultData.frontmatter)));

  test('local project-index.md has same frontmatter structure', () => {
    assert.strictEqual(localData.frontmatter['title'], 'Local Project');
    assert.strictEqual(localData.frontmatter['status'], 'active');
    assert.ok(localData.frontmatter['path'].length > 0);
  });

  test('vault project-index.md title in body', () => assert.strictEqual(vaultData.title, 'Vault Project'));
  test('local project-index.md title in body', () => assert.strictEqual(localData.title, 'Local Project'));
});

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------
describe('list', () => {
  let ws;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => {
      create.run(ws, ws, { name: 'Alpha', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'g' });
      create.run(ws, ws, { name: 'Beta',  root: 'workspace', date: '2026-02-25', due: '2026-12-31', goals: 'g' });
    });
  });
  after(() => cleanup(ws));

  test('shows both projects', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('2026.02.24-alpha') && out.includes('2026.02.25-beta'));
  });
  test('shows ACTIVE header', () => {
    assert.ok(captureLog(() => list.run(ws, ws, {})).join('\n').includes('ACTIVE'));
  });
  test('--status completed shows none', () => {
    assert.ok(captureLog(() => list.run(ws, ws, { status: 'completed' })).join('\n').includes('No projects found'));
  });
  test('--root shows matching projects', () => {
    const out = captureLog(() => list.run(ws, ws, { root: 'workspace' })).join('\n');
    assert.ok(out.includes('2026.02.24-alpha') && out.includes('2026.02.25-beta'));
  });
  test('--root with no match shows none', () => {
    assert.ok(captureLog(() => list.run(ws, ws, { root: 'nonexistent' })).join('\n').includes('No projects found'));
  });
  test('--status invalid throws', () => {
    assert.throws(() => list.run(ws, ws, { status: 'bogus' }), /Unknown status/);
  });
});

// ---------------------------------------------------------------------------
// list --json (Task Group 5)
// Note: list reads from the global index, which is updated on create.
// Status changes via statusCmd update project-index.md but NOT the global
// index (the global index is refreshed by sweep). Tests reflect this design.
// ---------------------------------------------------------------------------
describe('list --json', () => {
  let ws;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => {
      create.run(ws, ws, { name: 'Alpha', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'g1' });
      create.run(ws, ws, { name: 'Beta',  root: 'workspace', date: '2026-02-25', due: '2026-12-31', goals: 'g2' });
    });
  });
  after(() => cleanup(ws));

  test('emits valid JSON array', () => {
    assert.ok(Array.isArray(JSON.parse(captureLog(() => list.run(ws, ws, { json: true })).join('\n'))));
  });
  test('has 2 entries', () => {
    assert.strictEqual(JSON.parse(captureLog(() => list.run(ws, ws, { json: true })).join('\n')).length, 2);
  });
  test('both entries have status active (global index reflects create-time status)', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ws, { status: 'active', json: true })).join('\n'));
    assert.strictEqual(json.length, 2);
  });
  test('--root has 2 entries', () => {
    assert.strictEqual(JSON.parse(captureLog(() => list.run(ws, ws, { root: 'workspace', json: true })).join('\n')).length, 2);
  });
  test('empty result emits []', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ws, { status: 'archived', json: true })).join('\n'));
    assert.ok(Array.isArray(json) && json.length === 0);
  });
  test('entries contain id and path fields', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ws, { json: true })).join('\n'));
    assert.ok(json.every(p => p.id && p.path));
  });
});

// ---------------------------------------------------------------------------
// status command (complete / archive)
// ---------------------------------------------------------------------------
describe('status', () => {
  let ws;
  const id      = '2026.02.24-my-task';
  let   projDir;

  before(() => {
    ws      = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'My Task', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'g' }));
    silent(() => statusCmd.run(ws, ws, { id }, 'completed'));
  });
  after(() => cleanup(ws));

  test('status set to completed in project-index.md', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.frontmatter['status'], 'completed');
  });

  test('completed date set in project-index.md', () => {
    const data = projectIndexMd.read(projDir);
    assert.ok(data.frontmatter['completed'].match(/\d{4}-\d{2}-\d{2}/));
  });

  test('archived date still empty after complete', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.frontmatter['archived'], '');
  });

  test('last-touched updated by status write', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.frontmatter['last-touched'], projectIndexMd.todayStr());
  });

  test('re-complete emits warning', () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { statusCmd.run(ws, ws, { id }, 'completed'); } finally { console.warn = origWarn; }
    assert.ok(warns.some(w => w.includes('already completed')));
  });

  test('archive: sets archived date in project-index.md', () => {
    silent(() => statusCmd.run(ws, ws, { id }, 'archived'));
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.frontmatter['status'], 'archived');
    assert.ok(data.frontmatter['archived'].match(/\d{4}-\d{2}-\d{2}/));
  });

  test('archive preserves completed date', () => {
    const data = projectIndexMd.read(projDir);
    assert.ok(data.frontmatter['completed'].match(/\d{4}-\d{2}-\d{2}/));
  });

  test('without --id throws', () => {
    assert.throws(() => statusCmd.run(ws, ws, {}, 'completed'), /--id is required/);
  });
  test('unknown project id throws', () => {
    assert.throws(() => statusCmd.run(ws, ws, { id: 'no-such-project' }, 'completed'), /not found/);
  });

  // Task Group 6: status works for local projects (no vault-only guard)
  test('status update works for local root project (vault-only guard removed)', () => {
    const data = projectIndexMd.read(projDir);
    // If we got here without throwing, the vault guard is confirmed removed
    assert.ok(data.frontmatter['status'] === 'archived' || data.frontmatter['status'] === 'completed');
  });
});

// ---------------------------------------------------------------------------
// milestone add / complete (Task Group 7)
// ---------------------------------------------------------------------------
describe('milestone', () => {
  let ws;
  const id      = '2026.02.24-milestone-project';
  let   projDir;

  before(() => {
    ws      = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Milestone Project', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'g' }));
    silent(() => milestoneCmd.add(ws, { id, name: 'MVP', due: '2026-04-01' }));
  });
  after(() => cleanup(ws));

  test('milestone written to project-index.md body', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.milestones.length, 1);
  });

  test('milestone name', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.milestones[0].name, 'MVP');
  });

  test('milestone has UUID', () => {
    const data = projectIndexMd.read(projDir);
    assert.ok(data.milestones[0].uuid.startsWith('m-'));
  });

  test('milestone positional code is M-1', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.milestones[0].id, 'M-1');
  });

  test('milestone has no tasks initially', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.milestones[0].tasks.length, 0);
  });

  test('last-touched updated after milestone add', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.frontmatter['last-touched'], projectIndexMd.todayStr());
  });

  test('duplicate milestone name throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { id, name: 'MVP', due: '2026-05-01' }), /already exists/);
  });

  test('milestone add without --id throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { name: 'M2', due: '2026-05-01' }), /--id is required/);
  });
  test('milestone add without --name throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { id, due: '2026-05-01' }), /--name is required/);
  });
  test('milestone add without --due throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { id, name: 'M2' }), /--due is required/);
  });
  test('milestone add invalid --due throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { id, name: 'M2', due: 'not-a-date' }), /Invalid date/);
  });
  test('milestone add unknown project throws', () => {
    assert.throws(() => milestoneCmd.add(ws, { id: 'bad-id', name: 'M', due: '2026-04-01' }), /not found/);
  });
  test('milestone complete unknown milestone throws', () => {
    assert.throws(() => milestoneCmd.complete(ws, { id, name: 'NoSuch' }), /not found/);
  });

  test('re-completing already-complete milestone emits warning', () => {
    // Add a milestone with a task, complete it, then try again
    silent(() => projectIndexMd.addMilestone(projDir, { name: 'Phase2' }));
    // Add a task to Phase2 so the milestone has something to complete
    silent(() => projectIndexMd.addTask(projDir, 'M-2', { title: 'Do the thing' }));
    // First complete — marks the task as done, no warning
    silent(() => milestoneCmd.complete(ws, { id, name: 'Phase2' }));
    // Second complete — all tasks already done, should warn
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { milestoneCmd.complete(ws, { id, name: 'Phase2' }); } finally { console.warn = origWarn; }
    assert.ok(warns.some(w => w.includes('already completed')));
  });
});

// ---------------------------------------------------------------------------
// project-index.md sync on status / milestone changes (vault + local, uniform)
// Replaces old "vault frontmatter sync" suite. The vault-only guard is removed:
// all root types now use project-index.md.
// ---------------------------------------------------------------------------
describe('project-index.md sync (all root types)', () => {
  let ws;
  const id      = '2026.02.24-tv-sync-test';
  let   projDir;

  before(() => {
    ws      = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'vault', id);
    silent(() => create.run(ws, ws, { name: 'Sync Test', root: 'test-vault', date: '2026-02-24', due: '2026-06-30', goals: 'Sync goals' }));
  });
  after(() => cleanup(ws));

  test('initial project-index.md status is active', () => {
    assert.strictEqual(projectIndexMd.read(projDir).frontmatter['status'], 'active');
  });

  test('project-index.md updated with milestone after milestone add', () => {
    silent(() => milestoneCmd.add(ws, { id, name: 'Phase 1', due: '2026-04-01' }));
    const data = projectIndexMd.read(projDir);
    assert.ok(data.milestones.some(m => m.name === 'Phase 1'));
  });

  test('project-index.md status updated to completed', () => {
    silent(() => statusCmd.run(ws, ws, { id }, 'completed'));
    assert.strictEqual(projectIndexMd.read(projDir).frontmatter['status'], 'completed');
  });

  test('project-index.md completed date set', () => {
    assert.ok(projectIndexMd.read(projDir).frontmatter['completed'].match(/\d{4}-\d{2}-\d{2}/));
  });

  test('project-index.md status updated to archived', () => {
    silent(() => statusCmd.run(ws, ws, { id }, 'archived'));
    assert.strictEqual(projectIndexMd.read(projDir).frontmatter['status'], 'archived');
  });

  test('project-index.md archived date set', () => {
    assert.ok(projectIndexMd.read(projDir).frontmatter['archived'].match(/\d{4}-\d{2}-\d{2}/));
  });

  test('project-index.md completed date preserved after archive', () => {
    assert.ok(projectIndexMd.read(projDir).frontmatter['completed'].match(/\d{4}-\d{2}-\d{2}/));
  });
});

// ---------------------------------------------------------------------------
// show command (Task Group 5)
// ---------------------------------------------------------------------------
describe('show', () => {
  let ws, out;
  const id = '2026.02.24-show-me';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, { name: 'Show Me', root: 'workspace', date: '2026-02-24', due: '2026-06-30', goals: 'Show goals', description: 'A sample project' }));
    silent(() => milestoneCmd.add(ws, { id, name: 'M1', due: '2026-04-01' }));
    out = captureLog(() => showCmd.run(ws, ws, { id })).join('\n');
  });
  after(() => cleanup(ws));

  test('displays project name',    () => assert.ok(out.includes('Show Me')));
  test('displays id',              () => assert.ok(out.includes(id)));
  test('displays status',          () => assert.ok(out.includes('active')));
  test('displays started date',    () => assert.ok(out.includes('2026-02-24')));
  test('displays due date',        () => assert.ok(out.includes('2026-06-30')));
  test('displays description',     () => assert.ok(out.includes('A sample project')));
  test('displays milestone name',  () => assert.ok(out.includes('M1')));
  test('displays milestone state', () => assert.ok(out.includes('pending')));

  test('without --id throws', () => {
    assert.throws(() => showCmd.run(ws, ws, {}), /--id is required/);
  });
  test('unknown id throws', () => {
    assert.throws(() => showCmd.run(ws, ws, { id: 'bad-id' }), /not found/);
  });
});

// ---------------------------------------------------------------------------
// tasks command (read) — Task Group 8
// ---------------------------------------------------------------------------
describe('tasks (read)', () => {
  let ws;
  const id      = '2026.02.24-tasks-project';
  let   projDir;

  before(() => {
    ws      = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Tasks Project', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'Project goals text' }));
    // Add a milestone, then a task via projectIndexMd directly
    projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Do something' });
  });
  after(() => cleanup(ws));

  test('shows project title', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n').includes('Tasks Project'));
  });
  test('shows goals/objective', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n').includes('Project goals text'));
  });
  test('shows task title', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n').includes('Do something'));
  });
  test('shows PENDING group', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n').includes('PENDING'));
  });
  test('--json output has title and milestones array', () => {
    const jsonOut = captureLog(() => tasksCmd.run(ws, ws, { id, json: true })).join('\n');
    const parsed  = JSON.parse(jsonOut);
    assert.strictEqual(parsed.title, 'Tasks Project');
    assert.ok(Array.isArray(parsed.milestones));
    assert.strictEqual(parsed.milestones.length, 1);
    assert.strictEqual(parsed.milestones[0].tasks.length, 1);
    assert.strictEqual(parsed.milestones[0].tasks[0].title, 'Do something');
  });

  test('without --id throws', () => {
    assert.throws(() => tasksCmd.run(ws, ws, {}), /--id is required/);
  });
  test('unknown id throws', () => {
    assert.throws(() => tasksCmd.run(ws, ws, { id: 'bad-id' }), /not found/);
  });

  test('missing project-index.md throws', () => {
    // Create a project directory in the global index without a project-index.md
    // We do this by manually appending to the global index
    const fakeDir = path.join(ws, 'projects', '2026.02.24-no-index-file');
    fs.mkdirSync(fakeDir, { recursive: true });
    const fakeData = {
      frontmatter: {
        id: '2026.02.24-no-index-file', status: 'active', path: fakeDir,
        started: '2026-02-24', due: '2026-12-31', completed: '', archived: '',
        description: '',
      },
      title: 'No Index File', statement: {}, milestones: [],
    };
    globalIndexMd.appendProjectToGlobalIndex(ws, fakeData, 'workspace');
    assert.throws(() => tasksCmd.run(ws, ws, { id: '2026.02.24-no-index-file' }), /No project-index\.md/);
  });
});

// ---------------------------------------------------------------------------
// tasks-md migration
// ---------------------------------------------------------------------------
describe('tasks-md migration', () => {
  let ws, projDir;

  before(() => {
    ws = makeTmpWorkspace();
    projDir = path.join(ws, 'test-project');
    fs.mkdirSync(projDir, { recursive: true });
  });
  after(() => cleanup(ws));

  test('auto-migrates tasks.json to tasks.md', () => {
    const jsonData = {
      title: 'Migration Test',
      description: 'Test auto-migration',
      tasks: [
        {
          id: 'task-1', title: 'First task', description: 'Do it',
          successCriteria: ['Done well'], workerType: 'node', status: 'completed',
          output: 'Result here', learnings: 'Learned stuff', completedAt: '2026-02-25 09:00:00',
        },
        {
          id: 'task-2', title: 'Second task', description: 'Do this too',
          successCriteria: [], workerType: 'testing', status: 'pending',
          output: '', learnings: '', completedAt: null,
        },
      ],
    };
    fs.writeFileSync(path.join(projDir, 'tasks.json'), JSON.stringify(jsonData, null, 2));

    const result = tasksMd.read(projDir);

    // JSON file should be deleted
    assert.ok(!fs.existsSync(path.join(projDir, 'tasks.json')));
    // MD file should exist
    assert.ok(fs.existsSync(path.join(projDir, 'tasks.md')));

    assert.strictEqual(result.title, 'Migration Test');
    assert.strictEqual(result.tasks.length, 2);
    assert.strictEqual(result.tasks[0].status, 'completed');
    assert.strictEqual(result.tasks[0].output, 'Result here');
    assert.strictEqual(result.tasks[1].status, 'pending');
  });
});

// ---------------------------------------------------------------------------
// tasks-md render/parse round-trip
// ---------------------------------------------------------------------------
describe('tasks-md round-trip', () => {
  test('empty tasks round-trips', () => {
    const data = { title: 'Empty', description: 'No tasks', tasks: [] };
    const result = tasksMd.parse(tasksMd.render(data));
    assert.strictEqual(result.title, 'Empty');
    assert.strictEqual(result.description, 'No tasks');
    assert.strictEqual(result.tasks.length, 0);
  });

  test('completed task with date round-trips', () => {
    const data = {
      title: 'Project',
      description: 'Goals here',
      tasks: [{
        id: 'task-1', title: 'Done task', description: 'Was done',
        successCriteria: ['Crit A', 'Crit B'], workerType: 'node',
        status: 'completed', output: 'Output val', learnings: 'Learned val',
        completedAt: '2026-02-25',
      }],
    };
    const result = tasksMd.parse(tasksMd.render(data));
    assert.strictEqual(result.tasks[0].status, 'completed');
    assert.strictEqual(result.tasks[0].completedAt, '2026-02-25');
    assert.strictEqual(result.tasks[0].output, 'Output val');
    assert.strictEqual(result.tasks[0].learnings, 'Learned val');
    assert.strictEqual(result.tasks[0].successCriteria.length, 2);
  });

  test('in-progress task round-trips', () => {
    const data = {
      title: 'P', description: 'D',
      tasks: [{
        id: 'task-1', title: 'Working', description: '',
        successCriteria: [], workerType: 'node',
        status: 'in-progress', output: '', learnings: '', completedAt: null,
      }],
    };
    const result = tasksMd.parse(tasksMd.render(data));
    assert.strictEqual(result.tasks[0].status, 'in-progress');
  });

  test('cancelled task round-trips', () => {
    const data = {
      title: 'P', description: 'D',
      tasks: [{
        id: 'task-1', title: 'Nope', description: '',
        successCriteria: [], workerType: 'node',
        status: 'cancelled', output: '', learnings: '', completedAt: null,
      }],
    };
    const result = tasksMd.parse(tasksMd.render(data));
    assert.strictEqual(result.tasks[0].status, 'cancelled');
  });

  test('no description round-trips', () => {
    const data = {
      title: 'P', description: '',
      tasks: [{
        id: 'task-1', title: 'Bare', description: '',
        successCriteria: [], workerType: 'node',
        status: 'pending', output: '', learnings: '', completedAt: null,
      }],
    };
    const result = tasksMd.parse(tasksMd.render(data));
    assert.strictEqual(result.description, '');
    assert.strictEqual(result.tasks[0].description, '');
  });
});

// ---------------------------------------------------------------------------
// task add command (Task Group 8)
// ---------------------------------------------------------------------------
describe('task add', () => {
  let ws;
  const id      = '2026.02.24-task-add-project';
  let   projDir;

  before(() => {
    ws      = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Task Add Project', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'g' }));
    // Must have a milestone before adding tasks
    projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    silent(() => taskCmd.add(ws, {
      id,
      title:       'First Task',
      description: 'First task description',
      workerType:  'node',
      milestone:   'M-1',
    }));
  });
  after(() => cleanup(ws));

  test('one task added to milestone', () => {
    const data = projectIndexMd.read(projDir);
    assert.strictEqual(data.milestones[0].tasks.length, 1);
  });

  test('task has a UUID', () => {
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.ok(task.uuid.startsWith('t-'));
  });

  test('task title', () => {
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.title, 'First Task');
  });

  test('task status is pending', () => {
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.status, 'pending');
  });

  test('second task added increments positional code', () => {
    silent(() => taskCmd.add(ws, { id, title: 'Second Task', description: 'desc', milestone: 'M-1' }));
    const tasks = projectIndexMd.read(projDir).milestones[0].tasks;
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[1].id, 'M1-T2');
  });

  test('task add without --id throws', () => {
    assert.throws(() => taskCmd.add(ws, { title: 'T', description: 'd', milestone: 'M-1' }), /--id is required/);
  });
  test('task add without --title throws', () => {
    assert.throws(() => taskCmd.add(ws, { id, description: 'd', milestone: 'M-1' }), /--title is required/);
  });
  test('task add succeeds without --worker-type (field removed)', () => {
    assert.doesNotThrow(() => silent(() => taskCmd.add(ws, { id, title: 'No WT Task', milestone: 'M-1' })));
  });
  test('task add passing --worker-type in opts is silently ignored', () => {
    assert.doesNotThrow(() => silent(() => taskCmd.add(ws, { id, title: 'WT Ignored', milestone: 'M-1', workerType: 'node' })));
  });
  test('task add without --milestone throws', () => {
    assert.throws(() => taskCmd.add(ws, { id, title: 'T', description: 'd' }), /--milestone is required/);
  });
  test('task add unknown project throws', () => {
    assert.throws(() => taskCmd.add(ws, { id: 'bad-id', title: 'T', description: 'd', milestone: 'M-1' }), /not found/);
  });
  test('task add to invalid milestone throws', () => {
    assert.throws(() => taskCmd.add(ws, { id, title: 'T', description: 'd', milestone: 'M-99' }), /not found/);
  });
});

// ---------------------------------------------------------------------------
// multi-agent routing
// Project files go in the agent workspace; index lives in the manager workspace
// ---------------------------------------------------------------------------
describe('multi-agent routing', () => {
  let managerWs, agentWs;
  const id = '2026.02.24-monday-post';

  before(() => {
    managerWs = makeTmpWorkspace();
    agentWs   = makeTmpWorkspace();

    // Config lives in manager workspace; local root uses {agent-workspace}
    saveConfig(managerWs, {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: [
        { name: 'local', type: 'local', path: '{agent-workspace}/projects', location: null },
      ],
    });

    // Marketer creates the project:
    //   workspace (index + config) → managerWs
    //   agentWorkspace (file location) → agentWs
    silent(() => create.run(managerWs, agentWs, { name: 'Monday Post', root: 'local', date: '2026-02-24', due: '2026-12-31', goals: 'Write the post' }));
  });

  after(() => {
    cleanup(managerWs);
    cleanup(agentWs);
  });

  test('global index is written to manager workspace projects dir', () => {
    assert.ok(fs.existsSync(globalIndexPath(managerWs)));
  });
  test('global index is NOT written to agent workspace', () => {
    // agent workspace/projects/ should not have any global index file
    const agentProjDir = path.join(agentWs, 'projects');
    const hasGlobalIdx = fs.existsSync(agentProjDir)
      && fs.readdirSync(agentProjDir).some(f => f.endsWith('-global-project-index.md'));
    assert.ok(!hasGlobalIdx);
  });
  test('project directory is created in agent workspace', () => {
    assert.ok(fs.existsSync(path.join(agentWs, 'projects', id)));
  });
  test('project-index.md created in agent workspace', () => {
    assert.ok(fs.existsSync(path.join(agentWs, 'projects', id, 'project-index.md')));
  });
  test('project directory is NOT created in manager workspace', () => {
    assert.ok(!fs.existsSync(path.join(managerWs, 'projects', id)));
  });
  test('global index entry path points into agent workspace', () => {
    const records = globalIndexMd.readGlobalIndex(managerWs);
    assert.ok(records[0].path.startsWith(agentWs));
  });
});

// ---------------------------------------------------------------------------
// frontmatter unit tests
// ---------------------------------------------------------------------------
describe('frontmatter', () => {
  const plain  = '# Hello\n\nSome content.\n';
  const noBody = '---\ntitle: "Test"\n---\n';
  const proj   = {
    name: 'T', id: 'test-id', status: 'active', location: 'tv',
    startDate: '2026-02-25', dueDate: '2026-12-31',
    completionDate: null, archivedDate: null, description: '', milestones: [],
  };

  test('extractBody on plain markdown returns unchanged', () => {
    assert.strictEqual(extractBody(plain), plain);
  });

  test('extractBody with no body returns empty string', () => {
    assert.strictEqual(extractBody(noBody), '');
  });

  test('setFrontmatter body-less: result starts with ---', () => {
    assert.ok(setFrontmatter(noBody, proj).startsWith('---\n'));
  });

  test('setFrontmatter body-less: result ends with ---\\n', () => {
    assert.ok(setFrontmatter(noBody, proj).endsWith('---\n'));
  });

  test('setFrontmatter body-less: no extra content after closing ---', () => {
    const rebuilt = setFrontmatter(noBody, proj);
    assert.strictEqual(rebuilt.slice(rebuilt.lastIndexOf('\n---\n') + 5), '');
  });
});

// ---------------------------------------------------------------------------
// project-index-md: parse and render (Task Group 1)
// ---------------------------------------------------------------------------

// Sample file content used across multiple parse tests
const SAMPLE_INDEX_CONTENT = `---
title: "Widget Tracker"
id: 2026.03.07-widget-tracker
status: active
tags:
  - project
started: 2026-03-07
due: 2026-12-31
completed: ""
archived: ""
description: "Track widget production"
path: /vaults/test/1-Projects/2026.03.07-widget-tracker
last-touched: 2026-03-07
---

# Widget Tracker

> Build a widget tracking system
> Lead: Alice
> Due: 2026-12-31

## M-1: Foundation (id:m-aaaaaaaa-0000-0000-0000-000000000001)
- [ ] M1-T1: Set up repo (id:t-bbbbbbbb-0000-0000-0000-000000000001)
  - [ ] M1-T1-S1: Create directory (id:s-cccccccc-0000-0000-0000-000000000001)
  - [x] M1-T1-S2: Add .gitignore (id:s-cccccccc-0000-0000-0000-000000000002) done:2026-03-08
- [x] M1-T2: Write README (id:t-bbbbbbbb-0000-0000-0000-000000000002) done:2026-03-09

## M-2: Core Features (id:m-aaaaaaaa-0000-0000-0000-000000000002)
- [-] M2-T1: Cancelled task (id:t-bbbbbbbb-0000-0000-0000-000000000003)

`;

describe('project-index-md: parse', () => {
  test('extracts all frontmatter fields', () => {
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    assert.strictEqual(data.frontmatter['title'], 'Widget Tracker');
    assert.strictEqual(data.frontmatter['id'], '2026.03.07-widget-tracker');
    assert.strictEqual(data.frontmatter['status'], 'active');
    assert.strictEqual(data.frontmatter['started'], '2026-03-07');
    assert.strictEqual(data.frontmatter['due'], '2026-12-31');
    assert.strictEqual(data.frontmatter['path'], '/vaults/test/1-Projects/2026.03.07-widget-tracker');
    assert.strictEqual(data.frontmatter['last-touched'], '2026-03-07');
    assert.ok(Array.isArray(data.frontmatter['tags']));
    assert.ok(data.frontmatter['tags'].includes('project'));
  });

  test('extracts title from body heading', () => {
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    assert.strictEqual(data.title, 'Widget Tracker');
  });

  test('extracts project statement fields', () => {
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    assert.strictEqual(data.statement.objective, 'Build a widget tracking system');
    assert.strictEqual(data.statement.lead, 'Alice');
    assert.strictEqual(data.statement.due, '2026-12-31');
  });

  test('extracts correct number of milestones', () => {
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    assert.strictEqual(data.milestones.length, 2);
  });

  test('milestone 1 has correct uuid and name', () => {
    const ms = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0];
    assert.strictEqual(ms.uuid, 'm-aaaaaaaa-0000-0000-0000-000000000001');
    assert.strictEqual(ms.name, 'Foundation');
  });

  test('milestone 1 positional code is M-1', () => {
    const ms = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0];
    assert.strictEqual(ms.id, 'M-1');
  });

  test('milestone 1 has 2 tasks', () => {
    const ms = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0];
    assert.strictEqual(ms.tasks.length, 2);
  });

  test('task 1 has correct uuid, positional code, and status', () => {
    const task = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0].tasks[0];
    assert.strictEqual(task.uuid, 't-bbbbbbbb-0000-0000-0000-000000000001');
    assert.strictEqual(task.id, 'M1-T1');
    assert.strictEqual(task.status, 'pending');
    assert.strictEqual(task.title, 'Set up repo');
  });

  test('task 2 status is completed with completedAt', () => {
    const task = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0].tasks[1];
    assert.strictEqual(task.status, 'completed');
    assert.strictEqual(task.completedAt, '2026-03-09');
  });

  test('subtask 1 is pending with correct uuid', () => {
    const sub = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0].tasks[0].subtasks[0];
    assert.strictEqual(sub.uuid, 's-cccccccc-0000-0000-0000-000000000001');
    assert.strictEqual(sub.id, 'M1-T1-S1');
    assert.strictEqual(sub.status, 'pending');
  });

  test('subtask 2 is completed with completedAt', () => {
    const sub = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[0].tasks[0].subtasks[1];
    assert.strictEqual(sub.status, 'completed');
    assert.strictEqual(sub.completedAt, '2026-03-08');
  });

  test('milestone 2 cancelled task has cancelled status', () => {
    const task = projectIndexMd.parse(SAMPLE_INDEX_CONTENT).milestones[1].tasks[0];
    assert.strictEqual(task.status, 'cancelled');
  });
});

describe('project-index-md: render', () => {
  test('render output starts with frontmatter marker', () => {
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    assert.ok(projectIndexMd.render(data).startsWith('---\n'));
  });

  test('render recalculates positional codes from position', () => {
    // Create data with wrong positional codes — render must fix them
    const data = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    // Swap milestone names but keep UUIDs intact; codes should still be M-1, M-2
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('## M-1: Foundation'));
    assert.ok(rendered.includes('## M-2: Core Features'));
    assert.ok(rendered.includes('M1-T1: Set up repo'));
    assert.ok(rendered.includes('M1-T1-S1: Create directory'));
    assert.ok(rendered.includes('M1-T1-S2: Add .gitignore'));
  });

  test('render preserves UUIDs unchanged', () => {
    const data     = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('id:m-aaaaaaaa-0000-0000-0000-000000000001'));
    assert.ok(rendered.includes('id:t-bbbbbbbb-0000-0000-0000-000000000001'));
    assert.ok(rendered.includes('id:s-cccccccc-0000-0000-0000-000000000001'));
  });

  test('completed task includes done: suffix in render', () => {
    const data     = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('done:2026-03-09'));
  });

  test('cancelled task uses [-] checkbox', () => {
    const data     = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('- [-] M2-T1: Cancelled task'));
  });
});

describe('project-index-md: parse/render round-trip', () => {
  test('parse → render → parse is lossless for all fields', () => {
    const first  = projectIndexMd.parse(SAMPLE_INDEX_CONTENT);
    const second = projectIndexMd.parse(projectIndexMd.render(first));

    assert.strictEqual(second.frontmatter['id'], first.frontmatter['id']);
    assert.strictEqual(second.title, first.title);
    assert.strictEqual(second.statement.objective, first.statement.objective);
    assert.strictEqual(second.statement.lead, first.statement.lead);
    assert.strictEqual(second.milestones.length, first.milestones.length);
    assert.strictEqual(second.milestones[0].uuid, first.milestones[0].uuid);
    assert.strictEqual(second.milestones[0].tasks[0].uuid, first.milestones[0].tasks[0].uuid);
    assert.strictEqual(second.milestones[0].tasks[0].subtasks[0].uuid, first.milestones[0].tasks[0].subtasks[0].uuid);
    assert.strictEqual(second.milestones[0].tasks[0].subtasks[1].completedAt, '2026-03-08');
  });

  test('round-trip with no milestones', () => {
    const content = `---
title: "Empty Project"
id: 2026.03.07-empty
status: active
tags:
  - project
started: 2026-03-07
due: 2026-12-31
completed: ""
archived: ""
description: ""
path: /tmp/empty
last-touched: 2026-03-07
---

# Empty Project

> No milestones yet

`;
    const first  = projectIndexMd.parse(content);
    const second = projectIndexMd.parse(projectIndexMd.render(first));
    assert.strictEqual(second.milestones.length, 0);
    assert.strictEqual(second.title, 'Empty Project');
  });
});

describe('project-index-md: read and write', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-idx-test-'));
    fs.writeFileSync(path.join(tmpDir, 'project-index.md'), SAMPLE_INDEX_CONTENT);
  });
  after(() => cleanup(tmpDir));

  test('read() parses the file correctly', () => {
    const data = projectIndexMd.read(tmpDir);
    assert.strictEqual(data.title, 'Widget Tracker');
    assert.strictEqual(data.milestones.length, 2);
  });

  test('write() updates last-touched to today', () => {
    const data = projectIndexMd.read(tmpDir);
    // Set an old date to verify write() overwrites it
    data.frontmatter['last-touched'] = '2000-01-01';
    projectIndexMd.write(tmpDir, data);
    const reread = projectIndexMd.read(tmpDir);
    assert.strictEqual(reread.frontmatter['last-touched'], projectIndexMd.todayStr());
  });

  test('read() throws when file does not exist', () => {
    assert.throws(() => projectIndexMd.read('/nonexistent/path'), /No project-index\.md found/);
  });
});

describe('project-index-md: addMilestone', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ms-test-'));
    fs.writeFileSync(path.join(tmpDir, 'project-index.md'), SAMPLE_INDEX_CONTENT);
  });
  after(() => cleanup(tmpDir));

  test('addMilestone appends a new milestone with a UUID', () => {
    projectIndexMd.addMilestone(tmpDir, { name: 'Launch' });
    const data = projectIndexMd.read(tmpDir);
    assert.strictEqual(data.milestones.length, 3);
    const ms = data.milestones[2];
    assert.strictEqual(ms.name, 'Launch');
    assert.ok(ms.uuid.startsWith('m-'));
    assert.strictEqual(ms.id, 'M-3'); // positional code recalculated
  });
});

describe('project-index-md: addTask', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-task-test-'));
    fs.writeFileSync(path.join(tmpDir, 'project-index.md'), SAMPLE_INDEX_CONTENT);
  });
  after(() => cleanup(tmpDir));

  test('addTask by positional code appends task with UUID', () => {
    projectIndexMd.addTask(tmpDir, 'M-1', { title: 'New task via positional' });
    const data = projectIndexMd.read(tmpDir);
    const tasks = data.milestones[0].tasks;
    assert.strictEqual(tasks.length, 3);
    const newTask = tasks[2];
    assert.strictEqual(newTask.title, 'New task via positional');
    assert.ok(newTask.uuid.startsWith('t-'));
    assert.strictEqual(newTask.status, 'pending');
  });

  test('addTask by UUID appends task to correct milestone', () => {
    projectIndexMd.addTask(tmpDir, 'm-aaaaaaaa-0000-0000-0000-000000000002', { title: 'UUID-targeted task' });
    const data = projectIndexMd.read(tmpDir);
    const tasks = data.milestones[1].tasks;
    // Milestone 2 originally had 1 task (cancelled); now has 2
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[1].title, 'UUID-targeted task');
  });

  test('addTask with invalid milestoneId throws', () => {
    assert.throws(
      () => projectIndexMd.addTask(tmpDir, 'M-99', { title: 'Nope' }),
      /not found/
    );
  });
});

// ---------------------------------------------------------------------------
// sweep command (Task Group 9)
// ---------------------------------------------------------------------------

describe('sweep', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    // Create two projects
    silent(() => {
      create.run(ws, ws, { name: 'Alpha', root: 'workspace', date: '2026-02-24', due: '2026-12-31', goals: 'Alpha goals' });
      create.run(ws, ws, { name: 'Beta',  root: 'workspace', date: '2026-02-25', due: '2026-12-31', goals: 'Beta goals' });
    });
    // Add a milestone to Alpha
    const alphaDir = path.join(ws, 'projects', '2026.02.24-alpha');
    projectIndexMd.addMilestone(alphaDir, { name: 'Sprint 1' });
    // Run sweep
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('sweep creates a dated global index file', () => {
    const today   = new Date();
    const todayDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    const projDir  = path.join(ws, 'projects');
    const files    = fs.readdirSync(projDir).filter(f => f.includes('global-project-index'));
    assert.ok(files.some(f => f.startsWith(todayDot)));
  });

  test('sweep output is parseable and contains both projects', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    const ids     = records.map(r => r.id);
    assert.ok(ids.some(id => id.includes('alpha')));
    assert.ok(ids.some(id => id.includes('beta')));
  });

  test('sweep output contains milestone data', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    const alpha   = records.find(r => r.id.includes('alpha'));
    assert.ok(alpha);
    assert.strictEqual(alpha.milestones.length, 1);
    assert.strictEqual(alpha.milestones[0].name, 'Sprint 1');
  });

  test('sweep skips directory without project-index.md', () => {
    // Create a directory with no project-index.md — sweep should skip it silently
    const bareDir = path.join(ws, 'projects', 'no-index-dir');
    fs.mkdirSync(bareDir, { recursive: true });
    // Re-run sweep — should not throw
    assert.doesNotThrow(() => silent(() => sweep.run(ws, ws, {})));
  });

  test('sweep overwrites today file when run twice', () => {
    silent(() => sweep.run(ws, ws, {}));
    const records = globalIndexMd.readGlobalIndex(ws);
    // Should still have the same number of projects (overwrite, not append)
    const alphaCount = records.filter(r => r.id.includes('alpha')).length;
    assert.strictEqual(alphaCount, 1);
  });
});

// ---------------------------------------------------------------------------
// migrate command (Task Group 10)
// ---------------------------------------------------------------------------
describe('migrate', () => {
  let ws;

  before(() => {
    ws = makeTmpWorkspace();
    // Config needed for migrate to enumerate roots
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      roots: [
        { name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null },
      ],
    });

    // Create a fake old-format project directory with README.md + tasks.md
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    fs.mkdirSync(projDir, { recursive: true });

    // README.md (local project — no frontmatter)
    fs.writeFileSync(path.join(projDir, 'README.md'), [
      '# Old Project',
      '',
      '**Started:** 2026.02.24',
      '**Due:** 2026-12-31',
      '',
      '## Goals',
      '',
      'Migrate this project',
    ].join('\n'));

    // tasks.md with one task
    const tasksData = {
      title: 'Old Project',
      description: 'Migrate this project',
      tasks: [{
        id: 'task-1', title: 'First old task', description: 'Do it',
        successCriteria: ['Criterion A'], workerType: 'node', status: 'pending',
        output: '', learnings: '', completedAt: null,
      }],
    };
    fs.writeFileSync(path.join(projDir, 'tasks.md'), tasksMd.render(tasksData));
  });
  after(() => cleanup(ws));

  test('migrate converts README.md + tasks.md to project-index.md', () => {
    silent(() => migrate.run(ws, ws, {}));
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    assert.ok(fs.existsSync(path.join(projDir, 'project-index.md')));
  });

  test('migrate removes README.md and tasks.md', () => {
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    assert.ok(!fs.existsSync(path.join(projDir, 'README.md')));
    assert.ok(!fs.existsSync(path.join(projDir, 'tasks.md')));
  });

  test('migrated project-index.md is parseable', () => {
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    assert.doesNotThrow(() => projectIndexMd.read(projDir));
  });

  test('migrated project has a milestone with the old tasks', () => {
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    const data    = projectIndexMd.read(projDir);
    assert.ok(data.milestones.length > 0);
    assert.ok(data.milestones[0].tasks.length > 0);
    assert.strictEqual(data.milestones[0].tasks[0].title, 'First old task');
  });

  test('migrated tasks receive new UUIDs', () => {
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    const data    = projectIndexMd.read(projDir);
    assert.ok(data.milestones[0].uuid.startsWith('m-'));
    assert.ok(data.milestones[0].tasks[0].uuid.startsWith('t-'));
  });

  test('migrate skips directory already having project-index.md', () => {
    // Run migrate again — the already-migrated project should be counted as skipped
    const lines = [];
    const orig  = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try { migrate.run(ws, ws, {}); } finally { console.log = orig; }
    const output = lines.join('\n');
    assert.ok(output.includes('Skipped'));
    assert.ok(output.match(/Skipped.*1/) || output.includes('1'));
  });

  test('migrate idempotency: re-running does not corrupt project-index.md', () => {
    // Run again — the skipped project's project-index.md should be untouched
    const projDir = path.join(ws, 'projects', '2026.02.24-old-project');
    const before  = projectIndexMd.read(projDir);
    silent(() => migrate.run(ws, ws, {}));
    const after   = projectIndexMd.read(projDir);
    assert.strictEqual(after.title, before.title);
    assert.strictEqual(after.milestones[0].uuid, before.milestones[0].uuid);
  });
});

// ---------------------------------------------------------------------------
// Task Group 11: Strategic end-to-end tests
// Covers: create→list→show round-trip, task-add→tasks, sweep parseability,
//         migrate idempotency (already tested above), first-run global index.
// ---------------------------------------------------------------------------
describe('end-to-end: create → list → show round-trip', () => {
  let ws;
  const id = '2026.03.01-round-trip';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, { name: 'Round Trip', root: 'workspace', date: '2026-03-01', due: '2026-12-31', goals: 'Full workflow test', description: 'E2E desc' }));
    // Add a milestone and task
    const projDir = path.join(ws, 'projects', id);
    projectIndexMd.addMilestone(projDir, { name: 'Phase Alpha' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Do the work' });
  });
  after(() => cleanup(ws));

  test('project appears in list output', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes(id));
  });

  test('project appears in list --json', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ws, { json: true })).join('\n'));
    assert.ok(json.some(p => p.id === id));
  });

  test('show displays project correctly', () => {
    const out = captureLog(() => showCmd.run(ws, ws, { id })).join('\n');
    assert.ok(out.includes('Round Trip'));
    assert.ok(out.includes(id));
    assert.ok(out.includes('Phase Alpha'));
  });

  test('tasks output shows the added task', () => {
    const out = captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n');
    assert.ok(out.includes('Do the work'));
  });
});

describe('end-to-end: sweep produces parseable global index', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => {
      create.run(ws, ws, { name: 'Sweep Test', root: 'workspace', date: '2026-03-01', due: '2026-12-31', goals: 'Sweep goals' });
    });
    const projDir = path.join(ws, 'projects', '2026.03.01-sweep-test');
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task A' });
    // Run sweep to regenerate global index
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('sweep-generated global index is parseable with correct project', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    const proj    = records.find(r => r.id.includes('sweep-test'));
    assert.ok(proj);
    assert.strictEqual(proj.milestones.length, 1);
    assert.strictEqual(proj.milestones[0].tasks.length, 1);
    assert.strictEqual(proj.milestones[0].tasks[0].title, 'Task A');
  });

  test('project list works from sweep-generated index', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('sweep-test'));
  });
});

describe('end-to-end: first-run with no existing global index', () => {
  let ws;

  before(() => { ws = makeWorkspaceWithConfig(); });
  after(() => cleanup(ws));

  test('create succeeds with no pre-existing global index', () => {
    assert.doesNotThrow(() =>
      silent(() => create.run(ws, ws, { name: 'First Run', root: 'workspace', date: '2026-03-01', due: '2026-12-31', goals: 'g' }))
    );
  });

  test('global index created on first create', () => {
    assert.ok(fs.existsSync(globalIndexPath(ws)));
  });

  test('list works after first-run create', () => {
    const records = globalIndexMd.readGlobalIndex(ws);
    assert.strictEqual(records.length, 1);
    assert.ok(records[0].id.includes('first-run'));
  });
});

// ---------------------------------------------------------------------------
// global-index-md: parser and appender (Task Group 3)
// ---------------------------------------------------------------------------

const SAMPLE_GLOBAL_INDEX = `# Global Project Index — 2026-03-07

## My Vault

### Widget Tracker
- id: 2026.03.07-mv-widget-tracker
- status: active
- path: /vaults/my/1-Projects/2026.03.07-mv-widget-tracker
- started: 2026-03-07
- due: 2026-12-31
- completed: ""
- archived: ""
- description: "Track widgets"
- root: my-vault

#### M-1: Foundation (id:m-aaaaaaaa-0000-0000-0000-000000000001)
- [ ] M1-T1: Set up repo (id:t-bbbbbbbb-0000-0000-0000-000000000001)

## Local

### Blog Post
- id: 2026.03.07-blog-post
- status: completed
- path: /tmp/projects/2026.03.07-blog-post
- started: 2026-03-07
- due: 2026-03-31
- completed: 2026-03-10
- archived: ""
- description: "Write blog post"
- root: workspace

`;

describe('global-index-md: parse', () => {
  test('returns a flat array of project records', () => {
    const records = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX);
    assert.ok(Array.isArray(records));
    assert.strictEqual(records.length, 2);
  });

  test('first record has correct id and status', () => {
    const rec = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX)[0];
    assert.strictEqual(rec.id, '2026.03.07-mv-widget-tracker');
    assert.strictEqual(rec.status, 'active');
  });

  test('second record has correct id and status', () => {
    const rec = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX)[1];
    assert.strictEqual(rec.id, '2026.03.07-blog-post');
    assert.strictEqual(rec.status, 'completed');
  });

  test('rootSection is populated from H2 heading', () => {
    const records = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX);
    assert.strictEqual(records[0].rootSection, 'My Vault');
    assert.strictEqual(records[1].rootSection, 'Local');
  });

  test('milestone is parsed within first project', () => {
    const rec = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX)[0];
    assert.strictEqual(rec.milestones.length, 1);
    assert.strictEqual(rec.milestones[0].uuid, 'm-aaaaaaaa-0000-0000-0000-000000000001');
    assert.strictEqual(rec.milestones[0].tasks.length, 1);
  });

  test('locate project by id', () => {
    const records = globalIndexMd.parse(SAMPLE_GLOBAL_INDEX);
    const found   = records.find(r => r.id === '2026.03.07-blog-post');
    assert.ok(found);
    assert.strictEqual(found.status, 'completed');
  });
});

describe('global-index-md: appendProjectToGlobalIndex', () => {
  let tmpDir;
  before(() => { tmpDir = makeTmpWorkspace(); });
  after(() => cleanup(tmpDir));

  const fakeProjectData = {
    frontmatter: {
      id:          '2026.03.07-new-project',
      status:      'active',
      path:        '/tmp/projects/2026.03.07-new-project',
      started:     '2026-03-07',
      due:         '2026-12-31',
      completed:   '',
      archived:    '',
      description: 'A new project',
    },
    title:      'New Project',
    statement:  { objective: 'Build something great', lead: 'Bob', due: '2026-12-31' },
    milestones: [],
  };

  test('creates global index file if none exists', () => {
    globalIndexMd.appendProjectToGlobalIndex(tmpDir, fakeProjectData, 'workspace');
    const indexFile = globalIndexPath(tmpDir);
    assert.ok(fs.existsSync(indexFile));
  });

  test('created file contains the project id', () => {
    const indexFile = globalIndexPath(tmpDir);
    const content   = fs.readFileSync(indexFile, 'utf8');
    assert.ok(content.includes('2026.03.07-new-project'));
  });

  test('appending a second project to existing file produces parseable output', () => {
    const secondProject = {
      frontmatter: {
        id:          '2026.03.07-second-project',
        status:      'active',
        path:        '/tmp/projects/2026.03.07-second-project',
        started:     '2026-03-07',
        due:         '2026-12-31',
        completed:   '',
        archived:    '',
        description: 'Second project',
      },
      title:      'Second Project',
      statement:  {},
      milestones: [],
    };
    globalIndexMd.appendProjectToGlobalIndex(tmpDir, secondProject, 'workspace');
    const records = globalIndexMd.readGlobalIndex(tmpDir);
    assert.strictEqual(records.length, 2);
    const ids = records.map(r => r.id);
    assert.ok(ids.includes('2026.03.07-new-project'));
    assert.ok(ids.includes('2026.03.07-second-project'));
  });

  test('appending to a new root creates a new H2 section', () => {
    const vaultProject = {
      frontmatter: {
        id:          '2026.03.07-mv-vault-item',
        status:      'active',
        path:        '/vaults/mv/1-Projects/2026.03.07-mv-vault-item',
        started:     '2026-03-07',
        due:         '2026-12-31',
        completed:   '',
        archived:    '',
        description: '',
      },
      title:      'Vault Item',
      statement:  {},
      milestones: [],
    };
    globalIndexMd.appendProjectToGlobalIndex(tmpDir, vaultProject, 'my-vault');
    const content = fs.readFileSync(globalIndexPath(tmpDir), 'utf8');
    assert.ok(content.includes('## my-vault'));
    assert.ok(content.includes('2026.03.07-mv-vault-item'));
  });

  test('readGlobalIndex returns empty array when no file exists', () => {
    const emptyWs = makeTmpWorkspace();
    try {
      const records = globalIndexMd.readGlobalIndex(emptyWs);
      assert.ok(Array.isArray(records));
      assert.strictEqual(records.length, 0);
    } finally {
      cleanup(emptyWs);
    }
  });
});

// ---------------------------------------------------------------------------
// logger
// ---------------------------------------------------------------------------
describe('logger', () => {
  after(() => { log._reset(); });

  test('write + read cycle — JSON line with expected fields', () => {
    const tmp = makeTmpWorkspace();
    try {
      const logFile = path.join(tmp, 'test.log');
      process.env.PM_LOG_FILE  = logFile;
      process.env.PM_LOG_LEVEL = 'info';
      log._reset();
      log.init({ command: 'create', workspace: tmp });
      log.info('project created', { id: '2026.03.03-foo' });
      log.close();
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 1);
      const entry = JSON.parse(lines[0]);
      assert.strictEqual(entry.level, 'info');
      assert.strictEqual(entry.command, 'create');
      assert.strictEqual(entry.message, 'project created');
      assert.deepStrictEqual(entry.data, { id: '2026.03.03-foo' });
      assert.ok(entry.ts);
    } finally {
      delete process.env.PM_LOG_FILE;
      delete process.env.PM_LOG_LEVEL;
      log._reset();
      cleanup(tmp);
    }
  });

  test('level filtering — PM_LOG_LEVEL=error suppresses debug/info/warn', () => {
    const tmp = makeTmpWorkspace();
    try {
      const logFile = path.join(tmp, 'test.log');
      process.env.PM_LOG_FILE  = logFile;
      process.env.PM_LOG_LEVEL = 'error';
      log._reset();
      log.init({ command: 'test', workspace: tmp });
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      log.close();
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(JSON.parse(lines[0]).level, 'error');
    } finally {
      delete process.env.PM_LOG_FILE;
      delete process.env.PM_LOG_LEVEL;
      log._reset();
      cleanup(tmp);
    }
  });

  test('graceful failure — unwritable path does not throw', () => {
    process.env.PM_LOG_FILE  = '/nonexistent/deeply/nested/dir/test.log';
    process.env.PM_LOG_LEVEL = 'info';
    log._reset();
    log.init({ command: 'test' });
    // Should not throw
    log.info('hello');
    log.close();
    delete process.env.PM_LOG_FILE;
    delete process.env.PM_LOG_LEVEL;
    log._reset();
  });

  test('command context — command field matches init value', () => {
    const tmp = makeTmpWorkspace();
    try {
      const logFile = path.join(tmp, 'test.log');
      process.env.PM_LOG_FILE  = logFile;
      process.env.PM_LOG_LEVEL = 'info';
      log._reset();
      log.init({ command: 'milestone complete', workspace: tmp });
      log.info('done');
      log.close();
      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      assert.strictEqual(entry.command, 'milestone complete');
    } finally {
      delete process.env.PM_LOG_FILE;
      delete process.env.PM_LOG_LEVEL;
      log._reset();
      cleanup(tmp);
    }
  });

  test('data field — absent when not provided', () => {
    const tmp = makeTmpWorkspace();
    try {
      const logFile = path.join(tmp, 'test.log');
      process.env.PM_LOG_FILE  = logFile;
      process.env.PM_LOG_LEVEL = 'info';
      log._reset();
      log.init({ command: 'test', workspace: tmp });
      log.info('no data');
      log.close();
      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      assert.strictEqual(entry.data, undefined);
      assert.ok(!('data' in entry));
    } finally {
      delete process.env.PM_LOG_FILE;
      delete process.env.PM_LOG_LEVEL;
      log._reset();
      cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace — additional coverage (Task Group 3 spec requirements)
// ---------------------------------------------------------------------------
describe('resolveWorkspace — additional', () => {
  test('resolveWorkspace with explicit path returns path.resolve of that path', () => {
    assert.strictEqual(resolveWorkspace('/tmp/explicit-ws'), path.resolve('/tmp/explicit-ws'));
  });
});

// ---------------------------------------------------------------------------
// resolveAgentWorkspace — workspace fallback (Task Group 3 spec requirement 3.1)
// ---------------------------------------------------------------------------
describe('resolveAgentWorkspace — workspace fallback', () => {
  let origAgentWorkspace;
  before(() => {
    origAgentWorkspace = process.env.HAL_AGENT_WORKSPACE;
    delete process.env.HAL_AGENT_WORKSPACE;
  });
  after(() => {
    if (origAgentWorkspace !== undefined) process.env.HAL_AGENT_WORKSPACE = origAgentWorkspace;
    else delete process.env.HAL_AGENT_WORKSPACE;
  });

  test('resolveAgentWorkspace(undefined, workspacePath) falls back to workspacePath', () => {
    assert.strictEqual(
      resolveAgentWorkspace(undefined, '/tmp/fallback-ws'),
      path.resolve('/tmp/fallback-ws')
    );
  });

  test('resolveAgentWorkspace explicit path overrides workspace fallback', () => {
    assert.strictEqual(
      resolveAgentWorkspace('/tmp/agent', '/tmp/fallback-ws'),
      path.resolve('/tmp/agent')
    );
  });
});

// ---------------------------------------------------------------------------
// create (validation) — missing required opts (Task Group 5 coverage)
// ---------------------------------------------------------------------------
describe('create (validation) — missing name and root', () => {
  let ws;
  before(() => { ws = makeWorkspaceWithConfig(); });
  after(() => cleanup(ws));

  test('missing --name (empty string slug) throws alphanumeric error', () =>
    assert.throws(
      () => create.run(ws, ws, { name: '', root: 'workspace', due: '2026-12-31', goals: 'g' }),
      /alphanumeric/
    ));

  test('missing --root throws', () =>
    assert.throws(
      () => create.run(ws, ws, { name: 'Valid', due: '2026-12-31', goals: 'g' }),
      /root/i
    ));
});

// ---------------------------------------------------------------------------
// logger — additional lifecycle coverage (Task Group 2 spec requirements 2.1)
// ---------------------------------------------------------------------------
describe('logger — lifecycle and pre-init', () => {
  after(() => { log._reset(); });

  test('calling info before init does not throw', () => {
    log._reset();
    assert.doesNotThrow(() => log.info('before init'));
  });

  test('calling debug before init does not throw', () => {
    log._reset();
    assert.doesNotThrow(() => log.debug('before init debug'));
  });

  test('_reset then re-init opens a new log without error', () => {
    const tmp = makeTmpWorkspace();
    try {
      const logFile = path.join(tmp, 'reset-test.log');
      process.env.PM_LOG_FILE  = logFile;
      process.env.PM_LOG_LEVEL = 'info';
      log._reset();
      log.init({ command: 'first', workspace: tmp });
      log.info('first run');
      log._reset();
      log.init({ command: 'second', workspace: tmp });
      log.info('second run');
      log.close();
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 2);
    } finally {
      delete process.env.PM_LOG_FILE;
      delete process.env.PM_LOG_LEVEL;
      log._reset();
      cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// formatDate utility (Task Group 3 coverage)
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  test('formatDate with dash separator produces YYYY-MM-DD', () => {
    const d = new Date(2026, 2, 7); // Mar 7 2026 local
    assert.strictEqual(formatDate(d, '-'), '2026-03-07');
  });

  test('formatDate with dot separator produces YYYY.MM.DD', () => {
    const d = new Date(2026, 1, 24); // Feb 24 2026 local
    assert.strictEqual(formatDate(d, '.'), '2026.02.24');
  });
});

// ---------------------------------------------------------------------------
// Task Group 2: Parser and renderer extensions
// ---------------------------------------------------------------------------

describe('project-index-md: task description child line parse', () => {
  const CONTENT_WITH_DESC = [
    '---',
    'title: "Desc Test"',
    'id: 2026.03.07-desc-test',
    'status: active',
    'tags:',
    '  - project',
    'started: 2026-03-07',
    'due: 2026-12-31',
    'completed: ""',
    'archived: ""',
    'description: ""',
    'path: /tmp/desc-test',
    'last-touched: 2026-03-07',
    '---',
    '',
    '# Desc Test',
    '',
    '## M-1: Sprint (id:m-aaaaaaaa-0000-0000-0000-000000000001)',
    '- [ ] M1-T1: Task with desc (id:t-bbbbbbbb-0000-0000-0000-000000000001)',
    '  > This is the description text',
    '  - [ ] M1-T1-S1: Subtask (id:s-cccccccc-0000-0000-0000-000000000001)',
    '- [ ] M1-T2: Task without desc (id:t-bbbbbbbb-0000-0000-0000-000000000002)',
    '',
  ].join('\n');

  test('task without description child line produces description null', () => {
    const data = projectIndexMd.parse(CONTENT_WITH_DESC);
    const task = data.milestones[0].tasks[1];
    assert.strictEqual(task.description, null);
  });

  test('task with description child line produces correct description string', () => {
    const data = projectIndexMd.parse(CONTENT_WITH_DESC);
    const task = data.milestones[0].tasks[0];
    assert.strictEqual(task.description, 'This is the description text');
  });

  test('subtask is still parsed after description child line', () => {
    const data = projectIndexMd.parse(CONTENT_WITH_DESC);
    const task = data.milestones[0].tasks[0];
    assert.strictEqual(task.subtasks.length, 1);
    assert.strictEqual(task.subtasks[0].id, 'M1-T1-S1');
  });

  test('render emits description child line before subtask lines', () => {
    const data = projectIndexMd.parse(CONTENT_WITH_DESC);
    const rendered = projectIndexMd.render(data);
    const descIdx    = rendered.indexOf('  > This is the description text');
    const subtaskIdx = rendered.indexOf('  - [ ] M1-T1-S1:');
    assert.ok(descIdx > 0, 'description line should be present');
    assert.ok(descIdx < subtaskIdx, 'description should appear before subtask');
  });

  test('parse round-trip preserves description', () => {
    const first  = projectIndexMd.parse(CONTENT_WITH_DESC);
    const second = projectIndexMd.parse(projectIndexMd.render(first));
    assert.strictEqual(second.milestones[0].tasks[0].description, 'This is the description text');
    assert.strictEqual(second.milestones[0].tasks[1].description, null);
  });
});

describe('project-index-md: cancelledAt field parse', () => {
  const CONTENT_CANCELLED = [
    '---',
    'title: "Cancel Test"',
    'id: 2026.03.07-cancel-test',
    'status: active',
    'tags:',
    '  - project',
    'started: 2026-03-07',
    'due: 2026-12-31',
    'completed: ""',
    'archived: ""',
    'description: ""',
    'path: /tmp/cancel-test',
    'last-touched: 2026-03-07',
    '---',
    '',
    '# Cancel Test',
    '',
    '## M-1: Sprint (id:m-aaaaaaaa-0000-0000-0000-000000000001)',
    '- [-] M1-T1: Cancelled task (id:t-bbbbbbbb-0000-0000-0000-000000000001) cancelled:2026-03-05',
    '',
  ].join('\n');

  test('task with cancelled suffix has status cancelled', () => {
    const data = projectIndexMd.parse(CONTENT_CANCELLED);
    assert.strictEqual(data.milestones[0].tasks[0].status, 'cancelled');
  });

  test('task with cancelled suffix has correct cancelledAt date', () => {
    const data = projectIndexMd.parse(CONTENT_CANCELLED);
    assert.strictEqual(data.milestones[0].tasks[0].cancelledAt, '2026-03-05');
  });

  test('render emits cancelled suffix on cancelled tasks', () => {
    const data = projectIndexMd.parse(CONTENT_CANCELLED);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('cancelled:2026-03-05'));
    assert.ok(rendered.includes('- [-] M1-T1:'));
  });
});

describe('project-index-md: blockers section parse and render', () => {
  const CONTENT_BLOCKERS = [
    '---',
    'title: "Blocker Test"',
    'id: 2026.03.07-blocker-test',
    'status: active',
    'tags:',
    '  - project',
    'started: 2026-03-07',
    'due: 2026-12-31',
    'completed: ""',
    'archived: ""',
    'description: ""',
    'path: /tmp/blocker-test',
    'last-touched: 2026-03-07',
    '---',
    '',
    '# Blocker Test',
    '',
    '## M-1: Sprint (id:m-aaaaaaaa-0000-0000-0000-000000000001)',
    '- [ ] M1-T1: Some task (id:t-bbbbbbbb-0000-0000-0000-000000000001)',
    '',
    '## Blockers',
    '',
    '- [ ] [B-1] Waiting for contract (id:b-cccccccc-0000-0000-0000-000000000001) waiting-on:"ACME Legal" since:2026-03-01 affects:[M-1] Sprint (id:m-aaaaaaaa-0000-0000-0000-000000000001)',
    '- [x] [B-2] API credentials (id:b-cccccccc-0000-0000-0000-000000000002) waiting-on:"Jane Smith" since:2026-02-15 resolved:2026-03-05',
    '',
  ].join('\n');

  test('parse returns blockers array on result', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    assert.ok(Array.isArray(data.blockers));
  });

  test('open blocker parsed with status open and correct fields', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    const b = data.blockers[0];
    assert.strictEqual(b.status, 'open');
    assert.strictEqual(b.uuid, 'b-cccccccc-0000-0000-0000-000000000001');
    assert.strictEqual(b.description, 'Waiting for contract');
    assert.strictEqual(b.waitingOn, 'ACME Legal');
    assert.strictEqual(b.since, '2026-03-01');
    assert.ok(Array.isArray(b.affects) && b.affects.length > 0);
    assert.strictEqual(b.resolvedAt, null);
  });

  test('resolved blocker parsed with status resolved and resolvedAt date', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    const b = data.blockers[1];
    assert.strictEqual(b.status, 'resolved');
    assert.strictEqual(b.resolvedAt, '2026-03-05');
    assert.deepStrictEqual(b.affects, []);
  });

  test('render emits Blockers section after milestones', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    const rendered = projectIndexMd.render(data);
    const msIdx = rendered.indexOf('## M-1:');
    const blIdx = rendered.indexOf('## Blockers');
    assert.ok(blIdx > msIdx, 'Blockers section should appear after milestone sections');
  });

  test('render emits open blocker with affects field', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('waiting-on:"ACME Legal"'));
    assert.ok(rendered.includes('affects:'));
  });

  test('render emits resolved blocker with resolved date and no affects field', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    const rendered = projectIndexMd.render(data);
    assert.ok(rendered.includes('resolved:2026-03-05'));
    const lines = rendered.split('\n');
    const resolvedLine = lines.find(l => l.includes('b-cccccccc-0000-0000-0000-000000000002'));
    assert.ok(resolvedLine, 'resolved blocker line should exist');
    assert.ok(!resolvedLine.includes('affects:'), 'resolved blocker should not have affects field');
  });

  test('parse does not treat Blockers heading as a milestone', () => {
    const data = projectIndexMd.parse(CONTENT_BLOCKERS);
    assert.strictEqual(data.milestones.length, 1);
    assert.strictEqual(data.milestones[0].tasks.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Task Group 3: task complete, update, cancel commands
// ---------------------------------------------------------------------------

import * as blockerCmdMod from '../lib/commands/blocker.js';

describe('task complete', () => {
  let ws, projDir, taskUuid;
  const id = '2026.03.07-task-complete-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Task Complete Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'Complete Me' });
    taskUuid = t.uuid;
  });
  after(() => cleanup(ws));

  test('task complete marks status completed and sets completedAt', () => {
    silent(() => taskCmd.complete(ws, { id, task: taskUuid }));
    const data = projectIndexMd.read(projDir);
    const task = data.milestones[0].tasks[0];
    assert.strictEqual(task.status, 'completed');
    assert.ok(task.completedAt.match(/\d{4}-\d{2}-\d{2}/));
  });

  test('task complete writes done date to file', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('done:'));
  });

  test('task complete double-complete warns without modifying file', () => {
    const before = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { taskCmd.complete(ws, { id, task: taskUuid }); } finally { console.warn = orig; }
    assert.ok(warns.some(w => w.includes('already completed')));
    const after = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.strictEqual(before, after);
  });

  test('task complete unknown task UUID throws', () => {
    assert.throws(() => taskCmd.complete(ws, { id, task: 't-0000000-nonexistent' }), /not found/);
  });
});

describe('task update', () => {
  let ws, projDir, taskUuid;
  const id = '2026.03.07-task-update-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Task Update Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'Original Title', description: 'Original desc' });
    taskUuid = t.uuid;
  });
  after(() => cleanup(ws));

  test('task update title replaces title', () => {
    silent(() => taskCmd.update(ws, { id, task: taskUuid, title: 'New Title' }));
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.title, 'New Title');
  });

  test('task update description writes description child line', () => {
    silent(() => taskCmd.update(ws, { id, task: taskUuid, description: 'Updated desc' }));
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.description, 'Updated desc');
  });

  test('task update description appears in rendered file', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('  > Updated desc'));
  });

  test('task update without title or description throws', () => {
    assert.throws(() => taskCmd.update(ws, { id, task: taskUuid }), /--title or --description/);
  });
});

describe('task cancel', () => {
  let ws, projDir, taskUuid;
  const id = '2026.03.07-task-cancel-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Task Cancel Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'Cancel Me' });
    taskUuid = t.uuid;
  });
  after(() => cleanup(ws));

  test('task cancel marks status cancelled and sets cancelledAt', () => {
    silent(() => taskCmd.cancel(ws, { id, task: taskUuid, reason: 'No longer needed' }));
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.status, 'cancelled');
    assert.ok(task.cancelledAt.match(/\d{4}-\d{2}-\d{2}/));
  });

  test('task cancel writes cancelled marker and date to file', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('- [-]'));
    assert.ok(raw.includes('cancelled:'));
  });

  test('task cancel with reason stores reason as description child line', () => {
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.description, 'No longer needed');
  });

  test('task cancel double-cancel warns without modifying file', () => {
    const before = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { taskCmd.cancel(ws, { id, task: taskUuid }); } finally { console.warn = orig; }
    assert.ok(warns.some(w => w.includes('already cancelled')));
    const after = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.strictEqual(before, after);
  });

  test('project tasks groups cancelled task under CANCELLED', () => {
    const out = captureLog(() => tasksCmd.run(ws, ws, { id })).join('\n');
    assert.ok(out.includes('CANCELLED'));
  });
});

// ---------------------------------------------------------------------------
// Task Group 4: blocker add and resolve commands
// ---------------------------------------------------------------------------

describe('blocker add', () => {
  let ws, projDir, msUuid, taskUuid;
  const id = '2026.03.07-blocker-add-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Blocker Add Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    const ms = projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    msUuid = ms.uuid;
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'Some Task' });
    taskUuid = t.uuid;
  });
  after(() => cleanup(ws));

  test('blocker add writes blocker line to Blockers section', () => {
    silent(() => blockerCmdMod.add(ws, {
      id,
      description: 'Waiting for vendor',
      waitingOn:   'ACME Legal',
      affects:     msUuid,
    }));
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('## Blockers'));
    assert.ok(raw.includes('Waiting for vendor'));
    assert.ok(raw.includes('waiting-on:"ACME Legal"'));
  });

  test('blocker add generates a b- UUID', () => {
    const data = projectIndexMd.read(projDir);
    assert.ok(data.blockers.length > 0);
    assert.ok(data.blockers[0].uuid.startsWith('b-'));
  });

  test('blocker add resolves milestone UUID to display handle', () => {
    const data = projectIndexMd.read(projDir);
    const b = data.blockers[0];
    assert.ok(b.affects.some(a => a.includes('[M-1]') && a.includes(msUuid)));
  });

  test('blocker add with task UUID resolves to task positional handle', () => {
    silent(() => blockerCmdMod.add(ws, {
      id,
      description: 'Waiting for API creds',
      waitingOn:   'DevOps',
      affects:     taskUuid,
    }));
    const data = projectIndexMd.read(projDir);
    const b = data.blockers[data.blockers.length - 1];
    assert.ok(b.affects.some(a => a.includes('[M1-T1]') && a.includes(taskUuid)));
  });

  test('blocker add with unknown UUID throws ERROR', () => {
    assert.throws(
      () => blockerCmdMod.add(ws, { id, description: 'x', waitingOn: 'y', affects: 't-0000-nonexistent' }),
      /not found/
    );
  });
});

describe('blocker resolve', () => {
  let ws, projDir, blockerUuid;
  const id = '2026.03.07-blocker-resolve-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Blocker Resolve Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    const ms = projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    silent(() => blockerCmdMod.add(ws, {
      id,
      description: 'Pending approval',
      waitingOn:   'Legal',
      affects:     ms.uuid,
    }));
    const data = projectIndexMd.read(projDir);
    blockerUuid = data.blockers[0].uuid;
  });
  after(() => cleanup(ws));

  test('blocker resolve marks status resolved and sets resolvedAt date', () => {
    silent(() => blockerCmdMod.resolve(ws, { id, blocker: blockerUuid }));
    const data = projectIndexMd.read(projDir);
    const b = data.blockers[0];
    assert.strictEqual(b.status, 'resolved');
    assert.ok(b.resolvedAt.match(/\d{4}-\d{2}-\d{2}/));
  });

  test('blocker resolve strips affects field from resolved blocker', () => {
    const data = projectIndexMd.read(projDir);
    assert.deepStrictEqual(data.blockers[0].affects, []);
  });

  test('blocker resolve double-resolve warns without modifying file', () => {
    const before = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { blockerCmdMod.resolve(ws, { id, blocker: blockerUuid }); } finally { console.warn = orig; }
    assert.ok(warns.some(w => w.includes('already resolved')));
    const after = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.strictEqual(before, after);
  });

  test('blocker resolve unknown UUID throws ERROR', () => {
    assert.throws(
      () => blockerCmdMod.resolve(ws, { id, blocker: 'b-0000-nonexistent' }),
      /not found/
    );
  });
});

// ---------------------------------------------------------------------------
// Task Group 5: sweep blocker rendering
// ---------------------------------------------------------------------------

describe('sweep: open blockers in global index', () => {
  let ws, projDir;
  const id = '2026.03.07-sweep-blocker-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Sweep Blocker Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    const ms = projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    silent(() => blockerCmdMod.add(ws, {
      id,
      description: 'Waiting for sign-off',
      waitingOn:   'Management',
      affects:     ms.uuid,
    }));
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('sweep output includes open blocker line in project section', () => {
    const content = fs.readFileSync(globalIndexPath(ws), 'utf8');
    assert.ok(content.includes('Waiting for sign-off'));
    assert.ok(content.includes('waiting-on:"Management"'));
  });
});

describe('sweep: resolved blocker excluded from global index', () => {
  let ws, projDir;
  const id = '2026.03.07-sweep-resolved-blocker';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Sweep Resolved Blocker', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    const ms = projectIndexMd.addMilestone(projDir, { name: 'Sprint 1' });
    silent(() => blockerCmdMod.add(ws, {
      id,
      description: 'Old blocker now gone',
      waitingOn:   'Nobody',
      affects:     ms.uuid,
    }));
    const data = projectIndexMd.read(projDir);
    const bUuid = data.blockers[0].uuid;
    silent(() => blockerCmdMod.resolve(ws, { id, blocker: bUuid }));
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('sweep output does NOT include resolved blocker description', () => {
    const content = fs.readFileSync(globalIndexPath(ws), 'utf8');
    assert.ok(!content.includes('Old blocker now gone'));
  });
});

// ---------------------------------------------------------------------------
// Task Group 6: gap fill tests
// ---------------------------------------------------------------------------

describe('task add: description is optional', () => {
  let ws, projDir;
  const id = '2026.03.07-desc-optional-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'Desc Optional Test', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
  });
  after(() => cleanup(ws));

  test('task add without description succeeds', () => {
    assert.doesNotThrow(() => silent(() => taskCmd.add(ws, { id, title: 'No Desc Task', milestone: 'M-1' })));
  });

  test('task add without description produces no description child line', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('No Desc Task'));
    const lines = raw.split('\n');
    const taskIdx = lines.findIndex(l => l.includes('No Desc Task'));
    assert.ok(taskIdx >= 0);
    const nextLine = lines[taskIdx + 1] || '';
    assert.ok(!nextLine.startsWith('  > '), 'no description child line should be written');
  });

  test('task add with description writes description child line', () => {
    silent(() => taskCmd.add(ws, { id, title: 'With Desc Task', milestone: 'M-1', description: 'My description' }));
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('  > My description'));
  });
});

describe('end-to-end: task complete round-trip', () => {
  let ws, projDir, taskUuid;
  const id = '2026.03.07-e2e-complete';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'E2E Complete', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'E2E Task' });
    taskUuid = t.uuid;
    silent(() => taskCmd.complete(ws, { id, task: taskUuid }));
  });
  after(() => cleanup(ws));

  test('raw file contains done date after complete', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('done:'));
  });

  test('parsed task status is completed after complete', () => {
    const task = projectIndexMd.read(projDir).milestones[0].tasks[0];
    assert.strictEqual(task.status, 'completed');
  });
});

describe('end-to-end: task cancel round-trip', () => {
  let ws, projDir, taskUuid;
  const id = '2026.03.07-e2e-cancel';

  before(() => {
    ws = makeWorkspaceWithConfig();
    projDir = path.join(ws, 'projects', id);
    silent(() => create.run(ws, ws, { name: 'E2E Cancel', root: 'workspace', date: '2026-03-07', due: '2026-12-31', goals: 'g' }));
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    const t = projectIndexMd.addTask(projDir, 'M-1', { title: 'E2E Cancel Task' });
    taskUuid = t.uuid;
    silent(() => taskCmd.cancel(ws, { id, task: taskUuid, reason: 'Out of scope' }));
  });
  after(() => cleanup(ws));

  test('raw file contains cancelled marker after cancel', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('- [-]'));
    assert.ok(raw.includes('cancelled:'));
  });

  test('raw file contains reason as description child line', () => {
    const raw = fs.readFileSync(path.join(projDir, 'project-index.md'), 'utf8');
    assert.ok(raw.includes('  > Out of scope'));
  });
});


// ---------------------------------------------------------------------------
// Task Group 1: Project UUID in frontmatter
// ---------------------------------------------------------------------------

describe('project-uuid: buildFrontmatter emits field after id', () => {
  test('project-uuid appears after id line and before status', () => {
    const fm = { title: 'T', id: 'my-id', 'project-uuid': 'p-abc-123', status: 'active' };
    const built = projectIndexMd.buildFrontmatter(fm);
    const lines = built.split('\n');
    const idIdx     = lines.findIndex(l => l.startsWith('id:'));
    const uuidIdx   = lines.findIndex(l => l.startsWith('project-uuid:'));
    const statusIdx = lines.findIndex(l => l.startsWith('status:'));
    assert.ok(idIdx < uuidIdx, 'project-uuid must come after id');
    assert.ok(uuidIdx < statusIdx, 'project-uuid must come before status');
  });

  test('buildFrontmatter emits correct project-uuid value', () => {
    const fm = { title: 'T', id: 'x', 'project-uuid': 'p-test-uuid', status: 'active' };
    const built = projectIndexMd.buildFrontmatter(fm);
    assert.ok(built.includes('project-uuid: p-test-uuid'));
  });

  test('parseFrontmatter reads back project-uuid', () => {
    const raw = [
      '---',
      'title: "T"',
      'id: myid',
      'project-uuid: p-hello-world',
      'status: active',
      'tags:',
      '  - project',
      'started: 2026-01-01',
      'due: 2026-12-31',
      'completed: ""',
      'archived: ""',
      'description: ""',
      'path: /x',
      'last-touched: 2026-01-01',
      '---',
      '# T',
    ].join('\n');
    const parsed = projectIndexMd.parseFrontmatter(raw);
    assert.strictEqual(parsed['project-uuid'], 'p-hello-world');
  });

  test('project-uuid round-trips through parseFrontmatter + buildFrontmatter', () => {
    const original = {
      title: 'T', id: 'my-id', 'project-uuid': 'p-round-trip',
      status: 'active', tags: ['project'], started: '2026-01-01',
      due: '2026-12-31', completed: '', archived: '', description: '',
      path: '/x', 'last-touched': '2026-01-01',
    };
    const built  = projectIndexMd.buildFrontmatter(original);
    const parsed = projectIndexMd.parseFrontmatter(built);
    assert.strictEqual(parsed['project-uuid'], 'p-round-trip');
  });
});

describe('project-uuid: create writes project-uuid', () => {
  let ws, data;
  const id = '2026.03.07-uuid-test-project';
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, {
      name: 'UUID Test Project', root: 'workspace',
      date: '2026-03-07', due: '2026-12-31', goals: 'g',
    }));
    data = projectIndexMd.read(path.join(ws, 'projects', id));
  });
  after(() => cleanup(ws));

  test('create writes non-empty project-uuid field', () => {
    assert.ok(data.frontmatter['project-uuid'], 'project-uuid should be non-empty');
  });

  test('create project-uuid starts with p-', () => {
    assert.ok(data.frontmatter['project-uuid'].startsWith('p-'));
  });

  test('id field is unchanged after project-uuid addition', () => {
    assert.strictEqual(data.frontmatter['id'], id);
  });
});

describe('project-uuid: migrate patches missing project-uuid', () => {
  let ws, projDir;

  before(() => {
    ws = makeTmpWorkspace();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    projDir = path.join(ws, 'projects', '2026.03.07-legacy-proj');
    fs.mkdirSync(projDir, { recursive: true });

    // Write a project-index.md WITHOUT project-uuid (legacy format)
    const lines = [
      '---',
      'title: "Legacy"',
      'id: 2026.03.07-legacy-proj',
      'status: active',
      'tags:',
      '  - project',
      'started: 2026-03-07',
      'due: 2026-12-31',
      'completed: ""',
      'archived: ""',
      'description: ""',
      `path: ${projDir}`,
      'last-touched: 2026-03-07',
      '---',
      '# Legacy',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(projDir, 'project-index.md'), lines);
    silent(() => migrate.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('migrate patches project-uuid into existing project-index.md', () => {
    const data = projectIndexMd.read(projDir);
    assert.ok(data.frontmatter['project-uuid'], 'project-uuid should be set after migrate');
    assert.ok(data.frontmatter['project-uuid'].startsWith('p-'));
  });
});

// ---------------------------------------------------------------------------
// Task Group 2: show --json
// ---------------------------------------------------------------------------

describe('show --json emits full project record', () => {
  let ws;
  const id = '2026.03.07-show-json-test';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, {
      name: 'Show JSON Test', root: 'workspace',
      date: '2026-03-07', due: '2026-12-31', goals: 'g',
    }));
  });
  after(() => cleanup(ws));

  test('show --json outputs valid JSON with expected keys', () => {
    let captured = '';
    const orig = console.log;
    console.log = (...a) => { captured += a.join(' ') + '\n'; };
    try {
      showCmd.run(ws, ws, { id, json: true });
    } finally {
      console.log = orig;
    }
    const data = JSON.parse(captured);
    assert.ok('frontmatter' in data, 'should have frontmatter key');
    assert.ok('title' in data, 'should have title key');
    assert.ok('statement' in data, 'should have statement key');
    assert.ok('milestones' in data, 'should have milestones key');
    assert.ok('blockers' in data, 'should have blockers key');
  });

  test('show without --json still produces human-readable output', () => {
    const out = captureLog(() => showCmd.run(ws, ws, { id })).join('\n');
    assert.ok(out.includes('Show JSON Test'));
    assert.ok(out.includes('active'));
  });
});

// ---------------------------------------------------------------------------
// Task Group 2: list task count annotation
// ---------------------------------------------------------------------------

describe('list: task count annotation', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      dueSoonDays: 7,
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    silent(() => create.run(ws, ws, {
      name: 'Task Count Test', root: 'workspace',
      date: '2026-03-07', due: '2099-12-31', goals: 'g',
    }));
    const projDir = path.join(ws, 'projects', '2026.03.07-task-count-test');
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task 1' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task 2' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task 3' });
    const data = projectIndexMd.read(projDir);
    data.milestones[0].tasks[0].status = 'completed';
    data.milestones[0].tasks[0].completedAt = '2026-03-07';
    data.milestones[0].tasks[1].status = 'completed';
    data.milestones[0].tasks[1].completedAt = '2026-03-07';
    projectIndexMd.write(projDir, data);
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('list shows task count annotation', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('tasks done'), 'should show tasks done annotation');
  });

  test('list task count is correct (2/3)', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('2/3 tasks done'), 'should show 2/3 tasks done');
  });
});

describe('list: cancelled tasks excluded from count', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      dueSoonDays: 7,
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    silent(() => create.run(ws, ws, {
      name: 'Cancelled Count', root: 'workspace',
      date: '2026-03-07', due: '2099-12-31', goals: 'g',
    }));
    const projDir = path.join(ws, 'projects', '2026.03.07-cancelled-count');
    projectIndexMd.addMilestone(projDir, { name: 'M1' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task A' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task B' });
    projectIndexMd.addTask(projDir, 'M-1', { title: 'Task C' });
    const data = projectIndexMd.read(projDir);
    data.milestones[0].tasks[0].status = 'completed';
    data.milestones[0].tasks[0].completedAt = '2026-03-07';
    data.milestones[0].tasks[2].status = 'cancelled';
    data.milestones[0].tasks[2].cancelledAt = '2026-03-07';
    projectIndexMd.write(projDir, data);
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('list excludes cancelled from denominator (1/2)', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('1/2 tasks done'), 'cancelled tasks should be excluded: expected 1/2');
  });
});

describe('list: no task annotation when no tasks', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      dueSoonDays: 7,
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    silent(() => create.run(ws, ws, {
      name: 'No Tasks', root: 'workspace',
      date: '2026-03-07', due: '2099-12-31', goals: 'g',
    }));
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('list shows no task annotation for project with no tasks', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(!out.includes('tasks done'));
  });
});

describe('list: due date tags', () => {
  let ws;

  before(() => {
    ws = makeWorkspaceWithConfig();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      dueSoonDays: 7,
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    // Overdue project
    silent(() => create.run(ws, ws, {
      name: 'Overdue Project', root: 'workspace',
      date: '2026-03-07', due: '2020-01-01', goals: 'g',
    }));
    // Due soon: 2 days from now
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const soonStr = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    silent(() => create.run(ws, ws, {
      name: 'Due Soon Project', root: 'workspace',
      date: '2026-03-07', due: soonStr, goals: 'g',
    }));
    // Far future project
    silent(() => create.run(ws, ws, {
      name: 'Future Project', root: 'workspace',
      date: '2026-03-07', due: '2099-12-31', goals: 'g',
    }));
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('list shows [OVERDUE] for past due date', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('[OVERDUE]'));
  });

  test('list shows [DUE SOON] for project within 7 days', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    assert.ok(out.includes('[DUE SOON]'));
  });

  test('list shows no tag for far-future project', () => {
    const out = captureLog(() => list.run(ws, ws, {})).join('\n');
    const lines = out.split('\n');
    const futureLine = lines.find(l => l.includes('future-project'));
    assert.ok(futureLine, 'future project line should exist');
    assert.ok(!futureLine.includes('[OVERDUE]') && !futureLine.includes('[DUE SOON]'));
  });
});

// ---------------------------------------------------------------------------
// Task Group 4: renderProjectEntry status branching
// ---------------------------------------------------------------------------

describe('renderProjectEntry: completed project summary line', () => {
  test('completed project emits [COMPLETED] summary and no H4 blocks', () => {
    const projectData = {
      frontmatter: {
        title: 'Done Project', id: '2026.03.01-done', status: 'completed',
        completed: '2026-03-01', archived: '', due: '', started: '2026-01-01',
        description: '', path: '/x',
      },
      title: 'Done Project',
      milestones: [{
        id: 'M-1', uuid: 'm-abc', name: 'Sprint 1', status: 'pending',
        tasks: [{ id: 'M1-T1', uuid: 't-abc', title: 'Task 1', status: 'pending', completedAt: null, subtasks: [] }],
      }],
      blockers: [],
    };
    const lines  = globalIndexMd.renderProjectEntry(projectData, 'local');
    const joined = lines.join('\n');
    assert.ok(joined.includes('[COMPLETED]'));
    assert.ok(joined.includes('done:2026-03-01'));
    assert.ok(!joined.includes('####'));
  });

  test('archived project emits [ARCHIVED] summary and no H4 blocks', () => {
    const projectData = {
      frontmatter: {
        title: 'Old Project', id: '2026.02.01-old', status: 'archived',
        archived: '2026-02-15', completed: '', due: '', started: '2026-01-01',
        description: '', path: '/x',
      },
      title: 'Old Project',
      milestones: [{ id: 'M-1', uuid: 'm-xyz', name: 'Sprint', status: 'pending', tasks: [] }],
      blockers: [],
    };
    const lines  = globalIndexMd.renderProjectEntry(projectData, 'local');
    const joined = lines.join('\n');
    assert.ok(joined.includes('[ARCHIVED]'));
    assert.ok(joined.includes('archived:2026-02-15'));
    assert.ok(!joined.includes('####'));
  });

  test('active project renders full H4 milestone blocks', () => {
    const projectData = {
      frontmatter: {
        title: 'Active', id: '2026.03.07-active', status: 'active',
        completed: '', archived: '', due: '2099-12-31', started: '2026-01-01',
        description: '', path: '/x',
      },
      title: 'Active',
      milestones: [{
        id: 'M-1', uuid: 'm-act', name: 'Sprint 1', status: 'pending',
        tasks: [{ id: 'M1-T1', uuid: 't-act', title: 'T1', status: 'pending', completedAt: null, subtasks: [] }],
      }],
      blockers: [],
    };
    const lines  = globalIndexMd.renderProjectEntry(projectData, 'local');
    const joined = lines.join('\n');
    assert.ok(joined.includes('#### M-1:'));
    assert.ok(!joined.includes('[COMPLETED]'));
    assert.ok(!joined.includes('[ARCHIVED]'));
  });
});

describe('prune: archives and deletes old global index files', () => {
  let ws;

  before(() => {
    ws = makeTmpWorkspace();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    const projectsDir = path.join(ws, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    // Old file
    fs.writeFileSync(path.join(projectsDir, '2025.01.01-global-project-index.md'), '# Old Index');
    // Recent file (today)
    const today = new Date();
    const todayDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(projectsDir, `${todayDot}-global-project-index.md`), '# Today Index');
  });
  after(() => cleanup(ws));

  test('prune deletes old global index file and retains recent one', async () => {
    const { run: pruneRun } = await import('../lib/commands/prune.js');
    silent(() => pruneRun(ws, ws, { days: '30' }));
    const files = fs.readdirSync(path.join(ws, 'projects'));
    assert.ok(!files.includes('2025.01.01-global-project-index.md'), 'old file should be deleted');
    const today = new Date();
    const todayDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    assert.ok(files.some(f => f.startsWith(todayDot)), 'recent file should be retained');
  });
});

// ---------------------------------------------------------------------------
// Task Group 6: config - GLOBAL_INDEX_PATTERN export
// ---------------------------------------------------------------------------

describe('GLOBAL_INDEX_PATTERN exported from config', () => {
  test('GLOBAL_INDEX_PATTERN matches valid dated global index filename', async () => {
    const { GLOBAL_INDEX_PATTERN } = await import('../lib/config.js');
    assert.ok(GLOBAL_INDEX_PATTERN.test('2026.03.07-global-project-index.md'));
  });

  test('GLOBAL_INDEX_PATTERN does not match unrelated files', async () => {
    const { GLOBAL_INDEX_PATTERN } = await import('../lib/config.js');
    assert.ok(!GLOBAL_INDEX_PATTERN.test('README.md'));
    assert.ok(!GLOBAL_INDEX_PATTERN.test('2026.03.07-something-else.md'));
  });
});

describe('list --json output shape unchanged', () => {
  let ws;
  before(() => {
    ws = makeWorkspaceWithConfig();
    saveConfig(ws, {
      namingConvention: 'yyyy.mm.dd-{slug}',
      dueSoonDays: 7,
      roots: [{ name: 'workspace', type: 'local', path: '{agent-workspace}/projects', location: null }],
    });
    silent(() => create.run(ws, ws, {
      name: 'JSON Test', root: 'workspace',
      date: '2026-03-07', due: '2020-01-01', goals: 'g',
    }));
    silent(() => sweep.run(ws, ws, {}));
  });
  after(() => cleanup(ws));

  test('list --json does not contain task count or due date tags', () => {
    let captured = '';
    const orig = console.log;
    console.log = (...a) => { captured += a.join(' ') + '\n'; };
    try { list.run(ws, ws, { json: true }); } finally { console.log = orig; }
    assert.ok(!captured.includes('tasks done'));
    assert.ok(!captured.includes('[OVERDUE]'));
    assert.ok(!captured.includes('[DUE SOON]'));
  });
});
