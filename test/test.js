'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const {
  slugify, buildProjectId, resolveWorkspace, resolveAgentWorkspace, configPath, indexPath,
  saveConfig, loadIndex, saveIndex, parseArgs, formatDate,
} = require('../lib/config');

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
const create       = require('../lib/commands/create');
const list         = require('../lib/commands/list');
const statusCmd    = require('../lib/commands/status');
const showCmd      = require('../lib/commands/show');
const tasksCmd     = require('../lib/commands/tasks');
const taskCmd      = require('../lib/commands/task');
const milestoneCmd = require('../lib/commands/milestone');
const roots        = require('../lib/commands/roots');
const { extractBody, setFrontmatter } = require('../lib/frontmatter');

// ---------------------------------------------------------------------------
// Constants shared across test sections
// ---------------------------------------------------------------------------
const localRoot = { type: 'local', location: null };
const vaultRoot = { type: 'vault', location: 'lmb' };
const testDate  = new Date(2026, 1, 24); // Feb 24 2026 — local, no UTC shift

const BASE_CREATE = ['--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'Test goals'];

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
  let origAgent, origManager;
  before(() => {
    origAgent   = process.env.PROJECT_AGENT_WORKSPACE;
    origManager = process.env.PROJECT_MANAGER_WORKSPACE;
    delete process.env.PROJECT_AGENT_WORKSPACE;
    delete process.env.PROJECT_MANAGER_WORKSPACE;
  });
  after(() => {
    if (origAgent   !== undefined) process.env.PROJECT_AGENT_WORKSPACE   = origAgent;
    else delete process.env.PROJECT_AGENT_WORKSPACE;
    if (origManager !== undefined) process.env.PROJECT_MANAGER_WORKSPACE = origManager;
    else delete process.env.PROJECT_MANAGER_WORKSPACE;
  });

  test('no args, no env → cwd', () => {
    delete process.env.PROJECT_AGENT_WORKSPACE;
    delete process.env.PROJECT_MANAGER_WORKSPACE;
    assert.strictEqual(resolveWorkspace([]), process.cwd());
  });

  test('PROJECT_AGENT_WORKSPACE used when no other override', () => {
    process.env.PROJECT_AGENT_WORKSPACE = '/tmp/agent-ws';
    delete process.env.PROJECT_MANAGER_WORKSPACE;
    assert.strictEqual(resolveWorkspace([]), path.resolve('/tmp/agent-ws'));
  });

  test('PROJECT_MANAGER_WORKSPACE overrides PROJECT_AGENT_WORKSPACE', () => {
    process.env.PROJECT_AGENT_WORKSPACE   = '/tmp/agent-ws';
    process.env.PROJECT_MANAGER_WORKSPACE = '/tmp/manager-ws';
    assert.strictEqual(resolveWorkspace([]), path.resolve('/tmp/manager-ws'));
  });

  test('--workspace flag overrides PROJECT_MANAGER_WORKSPACE', () => {
    process.env.PROJECT_MANAGER_WORKSPACE = '/tmp/manager-ws';
    assert.strictEqual(resolveWorkspace(['--workspace', '/tmp/override']), path.resolve('/tmp/override'));
  });

  test('--workspace with no value throws', () => {
    assert.throws(() => resolveWorkspace(['--workspace']), /--workspace requires a path argument/);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentWorkspace
// ---------------------------------------------------------------------------
describe('resolveAgentWorkspace', () => {
  let origAgent, origManager;
  before(() => {
    origAgent   = process.env.PROJECT_AGENT_WORKSPACE;
    origManager = process.env.PROJECT_MANAGER_WORKSPACE;
    delete process.env.PROJECT_AGENT_WORKSPACE;
    delete process.env.PROJECT_MANAGER_WORKSPACE;
  });
  after(() => {
    if (origAgent   !== undefined) process.env.PROJECT_AGENT_WORKSPACE   = origAgent;
    else delete process.env.PROJECT_AGENT_WORKSPACE;
    if (origManager !== undefined) process.env.PROJECT_MANAGER_WORKSPACE = origManager;
    else delete process.env.PROJECT_MANAGER_WORKSPACE;
  });

  test('no env → cwd', () => {
    delete process.env.PROJECT_AGENT_WORKSPACE;
    delete process.env.PROJECT_MANAGER_WORKSPACE;
    assert.strictEqual(resolveAgentWorkspace(), process.cwd());
  });

  test('PROJECT_AGENT_WORKSPACE used when set', () => {
    process.env.PROJECT_AGENT_WORKSPACE = '/tmp/agent-ws';
    assert.strictEqual(resolveAgentWorkspace(), path.resolve('/tmp/agent-ws'));
  });

  test('PROJECT_MANAGER_WORKSPACE has no effect on agent workspace', () => {
    process.env.PROJECT_AGENT_WORKSPACE   = '/tmp/agent-ws';
    process.env.PROJECT_MANAGER_WORKSPACE = '/tmp/manager-ws';
    assert.strictEqual(resolveAgentWorkspace(), path.resolve('/tmp/agent-ws'));
  });
});

// ---------------------------------------------------------------------------
// parseArgs — boolean flags and repeated flags
// ---------------------------------------------------------------------------
describe('parseArgs', () => {
  test('captures string values', () => {
    assert.strictEqual(parseArgs(['--name', 'Foo', '--root', 'bar']).name, 'Foo');
  });

  test('--json with no value → true', () => {
    assert.strictEqual(parseArgs(['--json']).json, true);
  });

  test('--json after another flag → true', () => {
    const opts = parseArgs(['--status', 'active', '--json']);
    assert.strictEqual(opts.json, true);
    assert.strictEqual(opts.status, 'active');
  });

  test('repeated flag → array', () => {
    const opts = parseArgs(['--criteria', 'one', '--criteria', 'two']);
    assert.ok(Array.isArray(opts.criteria));
    assert.strictEqual(opts.criteria.length, 2);
    assert.strictEqual(opts.criteria[0], 'one');
    assert.strictEqual(opts.criteria[1], 'two');
  });

  test('single --criteria → string', () => {
    assert.strictEqual(parseArgs(['--criteria', 'only-one']).criteria, 'only-one');
  });
});

// ---------------------------------------------------------------------------
// configPath / indexPath
// ---------------------------------------------------------------------------
describe('configPath / indexPath', () => {
  test('configPath', () =>
    assert.strictEqual(configPath('/ws'), path.join('/ws', 'config', 'project-manager.json')));
  test('indexPath', () =>
    assert.strictEqual(indexPath('/ws'), path.join('/ws', 'projects', 'projects-index.json')));
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
    silent(() => create.run(ws, ws, ['--name', 'Test Project', ...BASE_CREATE]));
  });
  after(() => cleanup(ws));

  test('project directory created',    () => assert.ok(fs.existsSync(path.join(ws, 'projects', id))));
  test('README.md seeded',             () => assert.ok(fs.existsSync(path.join(ws, 'projects', id, 'README.md'))));
  test('tasks.json seeded',            () => assert.ok(fs.existsSync(path.join(ws, 'projects', id, 'tasks.json'))));

  test('one entry in index', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects.length, 1);
  });
  test('index entry id', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].id, id);
  });
  test('index entry status', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].status, 'active');
  });
  test('index startDate no UTC shift', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].startDate, '2026-02-24');
  });
  test('index dueDate stored', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].dueDate, '2026-12-31');
  });

  test('tasks.json title', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'projects', id, 'tasks.json'), 'utf8')).title, 'Test Project');
  });
  test('tasks.json description', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'projects', id, 'tasks.json'), 'utf8')).description, 'Test goals');
  });
  test('tasks.json tasks empty', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ws, 'projects', id, 'tasks.json'), 'utf8')).tasks.length, 0);
  });

  test('--date omitted: project id starts with today', () => {
    const wsTmp = makeWorkspaceWithConfig();
    try {
      silent(() => create.run(wsTmp, wsTmp, ['--name', 'Today Project', '--root', 'workspace', '--due', '2026-12-31', '--goals', 'g']));
      const today = new Date();
      const todayDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
      assert.ok(JSON.parse(fs.readFileSync(indexPath(wsTmp), 'utf8')).projects[0].id.startsWith(todayDot));
    } finally {
      cleanup(wsTmp);
    }
  });

  test('--date omitted: startDate is today', () => {
    const wsTmp = makeWorkspaceWithConfig();
    try {
      silent(() => create.run(wsTmp, wsTmp, ['--name', 'Today Project', '--root', 'workspace', '--due', '2026-12-31', '--goals', 'g']));
      const today = new Date();
      assert.strictEqual(
        JSON.parse(fs.readFileSync(indexPath(wsTmp), 'utf8')).projects[0].startDate,
        formatDate(today, '-'),
      );
    } finally {
      cleanup(wsTmp);
    }
  });

  test('duplicate id throws', () => {
    assert.throws(() => create.run(ws, ws, ['--name', 'Test Project', ...BASE_CREATE]), /already exists/);
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
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--goals', 'g']), /--due is required/));
  test('missing --goals throws', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--due', '2026-12-31']), /--goals is required/));
  test('whitespace-only --name rejected', () =>
    assert.throws(() => create.run(ws, ws, ['--name', '   ', '--root', 'workspace', '--due', '2026-12-31', '--goals', 'g']), /alphanumeric/));
  test('invalid --date format rejected', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--date', 'not-a-date', '--due', '2026-12-31', '--goals', 'g']), /Invalid date/));
  test('bad date like 2026/02/24 rejected', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--date', '2026/02/24', '--due', '2026-12-31', '--goals', 'g']), /Invalid date/));
  test('semantically invalid --date rejected (Feb 31)', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--date', '2026-02-31', '--due', '2026-12-31', '--goals', 'g']), /Invalid date/));
  test('invalid --due format rejected', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--due', 'not-a-date', '--goals', 'g']), /Invalid date/));
  test('semantically invalid --due rejected (Feb 31)', () =>
    assert.throws(() => create.run(ws, ws, ['--name', 'Valid', '--root', 'workspace', '--due', '2026-02-31', '--goals', 'g']), /Invalid date/));
});

// ---------------------------------------------------------------------------
// create (vault frontmatter)
// ---------------------------------------------------------------------------
describe('create (vault frontmatter)', () => {
  let ws, readme, localReadme;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Vault Project', '--root', 'test-vault', '--date', '2026-02-24', '--due', '2026-06-30', '--goals', 'Vault goals']));
    silent(() => create.run(ws, ws, ['--name', 'Local Project', '--root', 'workspace',  '--date', '2026-02-24', '--due', '2026-06-30', '--goals', 'Local goals']));
    readme      = fs.readFileSync(path.join(ws, 'vault',    '2026.02.24-tv-vault-project',  'README.md'), 'utf8');
    localReadme = fs.readFileSync(path.join(ws, 'projects', '2026.02.24-local-project', 'README.md'), 'utf8');
  });
  after(() => cleanup(ws));

  test('vault README starts with ---',       () => assert.ok(readme.startsWith('---\n')));
  test('vault README contains title field',  () => assert.ok(readme.includes('title: "Vault Project"')));
  test('vault README contains id field',     () => assert.ok(readme.includes('id: 2026.02.24-tv-vault-project')));
  test('vault README contains status field', () => assert.ok(readme.includes('status: active')));
  test('vault README contains tags',         () => assert.ok(readme.includes('- project')));
  test('vault README contains location',     () => assert.ok(readme.includes('location: tv')));
  test('vault README contains started',      () => assert.ok(readme.includes('started: 2026-02-24')));
  test('vault README contains due',          () => assert.ok(readme.includes('due: 2026-06-30')));
  test('vault README contains description',  () => assert.ok(readme.includes('description:')));
  test('vault README has closing ---',       () => assert.ok(readme.includes('\n---\n')));
  test('vault README body has # heading',    () => assert.ok(readme.includes('# Vault Project')));
  test('vault README body has Goals section',() => assert.ok(readme.includes('## Goals')));
  test('local README does NOT start with ---', () => assert.ok(!localReadme.startsWith('---\n')));
  test('local README has # heading',         () => assert.ok(localReadme.includes('# Local Project')));
});

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------
describe('list', () => {
  let ws;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => {
      create.run(ws, ws, ['--name', 'Alpha', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g']);
      create.run(ws, ws, ['--name', 'Beta',  '--root', 'workspace', '--date', '2026-02-25', '--due', '2026-12-31', '--goals', 'g']);
    });
  });
  after(() => cleanup(ws));

  test('shows both projects', () => {
    const out = captureLog(() => list.run(ws, [])).join('\n');
    assert.ok(out.includes('2026.02.24-alpha') && out.includes('2026.02.25-beta'));
  });
  test('shows ACTIVE header', () => {
    assert.ok(captureLog(() => list.run(ws, [])).join('\n').includes('ACTIVE'));
  });
  test('--status completed shows none', () => {
    assert.ok(captureLog(() => list.run(ws, ['--status', 'completed'])).join('\n').includes('No projects found'));
  });
  test('--root shows matching projects', () => {
    const out = captureLog(() => list.run(ws, ['--root', 'workspace'])).join('\n');
    assert.ok(out.includes('2026.02.24-alpha') && out.includes('2026.02.25-beta'));
  });
  test('--root with no match shows none', () => {
    assert.ok(captureLog(() => list.run(ws, ['--root', 'nonexistent'])).join('\n').includes('No projects found'));
  });
  test('--status invalid throws', () => {
    assert.throws(() => list.run(ws, ['--status', 'bogus']), /Unknown status/);
  });
});

// ---------------------------------------------------------------------------
// list --json
// ---------------------------------------------------------------------------
describe('list --json', () => {
  let ws;
  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => {
      create.run(ws, ws, ['--name', 'Alpha', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g1']);
      create.run(ws, ws, ['--name', 'Beta',  '--root', 'workspace', '--date', '2026-02-25', '--due', '2026-12-31', '--goals', 'g2']);
    });
    silent(() => statusCmd.run(ws, ['--id', '2026.02.25-beta'], 'completed'));
  });
  after(() => cleanup(ws));

  test('emits valid JSON array', () => {
    assert.ok(Array.isArray(JSON.parse(captureLog(() => list.run(ws, ['--json'])).join('\n'))));
  });
  test('has 2 entries', () => {
    assert.strictEqual(JSON.parse(captureLog(() => list.run(ws, ['--json'])).join('\n')).length, 2);
  });
  test('--status active has 1 entry and correct id', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ['--status', 'active', '--json'])).join('\n'));
    assert.strictEqual(json.length, 1);
    assert.strictEqual(json[0].id, '2026.02.24-alpha');
  });
  test('--root has 2 entries', () => {
    assert.strictEqual(JSON.parse(captureLog(() => list.run(ws, ['--root', 'workspace', '--json'])).join('\n')).length, 2);
  });
  test('empty result emits []', () => {
    const json = JSON.parse(captureLog(() => list.run(ws, ['--status', 'archived', '--json'])).join('\n'));
    assert.ok(Array.isArray(json) && json.length === 0);
  });
});

// ---------------------------------------------------------------------------
// status command (complete / archive)
// ---------------------------------------------------------------------------
describe('status', () => {
  let ws;
  const id = '2026.02.24-my-task';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'My Task', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g']));
    silent(() => statusCmd.run(ws, ['--id', id], 'completed'));
  });
  after(() => cleanup(ws));

  test('status set to completed', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].status, 'completed');
  });
  test('completionDate set', () => {
    assert.ok(!!JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].completionDate);
  });
  test('archivedDate still null', () => {
    assert.ok(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].archivedDate === null);
  });

  test('re-complete emits warning and does not overwrite completionDate', () => {
    const origDate = JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].completionDate;
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { statusCmd.run(ws, ['--id', id], 'completed'); } finally { console.warn = origWarn; }
    assert.ok(warns.some(w => w.includes('already completed')));
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].completionDate, origDate);
  });

  test('archive: sets archivedDate and preserves completionDate', () => {
    const origDate = JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].completionDate;
    silent(() => statusCmd.run(ws, ['--id', id], 'archived'));
    const idx = JSON.parse(fs.readFileSync(indexPath(ws), 'utf8'));
    assert.strictEqual(idx.projects[0].status, 'archived');
    assert.ok(!!idx.projects[0].archivedDate);
    assert.strictEqual(idx.projects[0].completionDate, origDate);
  });

  test('without --id throws', () => {
    assert.throws(() => statusCmd.run(ws, [], 'completed'), /--id is required/);
  });
  test('unknown project id throws', () => {
    assert.throws(() => statusCmd.run(ws, ['--id', 'no-such-project'], 'completed'), /not found/);
  });
});

// ---------------------------------------------------------------------------
// milestone add / complete
// ---------------------------------------------------------------------------
describe('milestone', () => {
  let ws;
  const id = '2026.02.24-milestone-project';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Milestone Project', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g']));
    silent(() => milestoneCmd.add(ws, ['--id', id, '--name', 'MVP', '--due', '2026-04-01']));
  });
  after(() => cleanup(ws));

  test('milestones array has one entry', () => {
    assert.ok(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].milestones.length === 1);
  });
  test('milestone name', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].milestones[0].name, 'MVP');
  });
  test('milestone due', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].milestones[0].due, '2026-04-01');
  });
  test('milestone completedDate is null', () => {
    assert.ok(JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].milestones[0].completedDate === null);
  });

  test('duplicate milestone name throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--id', id, '--name', 'MVP', '--due', '2026-05-01']), /already exists/);
  });

  test('complete milestone sets completedDate', () => {
    silent(() => milestoneCmd.complete(ws, ['--id', id, '--name', 'MVP']));
    assert.ok(!!JSON.parse(fs.readFileSync(indexPath(ws), 'utf8')).projects[0].milestones[0].completedDate);
  });

  test('re-completing already-complete milestone emits warning', () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try { milestoneCmd.complete(ws, ['--id', id, '--name', 'MVP']); } finally { console.warn = origWarn; }
    assert.ok(warns.some(w => w.includes('already completed')));
  });

  test('milestone add without --id throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--name', 'M2', '--due', '2026-05-01']), /--id is required/);
  });
  test('milestone add without --name throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--id', id, '--due', '2026-05-01']), /--name is required/);
  });
  test('milestone add without --due throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--id', id, '--name', 'M2']), /--due is required/);
  });
  test('milestone add invalid --due throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--id', id, '--name', 'M2', '--due', 'not-a-date']), /Invalid date/);
  });
  test('milestone add unknown project throws', () => {
    assert.throws(() => milestoneCmd.add(ws, ['--id', 'bad-id', '--name', 'M', '--due', '2026-04-01']), /not found/);
  });
  test('milestone complete unknown milestone throws', () => {
    assert.throws(() => milestoneCmd.complete(ws, ['--id', id, '--name', 'NoSuch']), /not found/);
  });
});

// ---------------------------------------------------------------------------
// vault frontmatter sync on status / milestone changes
// ---------------------------------------------------------------------------
describe('vault frontmatter sync', () => {
  let ws;
  const id = '2026.02.24-tv-sync-test';
  let readmePath;

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Sync Test', '--root', 'test-vault', '--date', '2026-02-24', '--due', '2026-06-30', '--goals', 'Sync goals']));
    readmePath = path.join(ws, 'vault', id, 'README.md');
  });
  after(() => cleanup(ws));

  test('initial frontmatter status is active', () => {
    assert.ok(fs.readFileSync(readmePath, 'utf8').includes('status: active'));
  });

  test('frontmatter updated with milestone after milestone add', () => {
    silent(() => milestoneCmd.add(ws, ['--id', id, '--name', 'Phase 1', '--due', '2026-04-01']));
    assert.ok(fs.readFileSync(readmePath, 'utf8').includes('Phase 1'));
  });

  test('milestone completedDate appears in frontmatter after milestone complete', () => {
    silent(() => milestoneCmd.complete(ws, ['--id', id, '--name', 'Phase 1']));
    assert.ok(fs.readFileSync(readmePath, 'utf8').includes('completedDate:'));
  });

  test('frontmatter status updated to completed', () => {
    silent(() => statusCmd.run(ws, ['--id', id], 'completed'));
    assert.ok(fs.readFileSync(readmePath, 'utf8').includes('status: completed'));
  });

  test('frontmatter completed date set', () => {
    assert.ok(fs.readFileSync(readmePath, 'utf8').match(/completed: \d{4}-\d{2}-\d{2}/));
  });

  test('frontmatter status updated to archived', () => {
    silent(() => statusCmd.run(ws, ['--id', id], 'archived'));
    assert.ok(fs.readFileSync(readmePath, 'utf8').includes('status: archived'));
  });

  test('frontmatter archived date set', () => {
    assert.ok(fs.readFileSync(readmePath, 'utf8').match(/archived: \d{4}-\d{2}-\d{2}/));
  });

  test('frontmatter completed date preserved after archive', () => {
    assert.ok(fs.readFileSync(readmePath, 'utf8').match(/completed: \d{4}-\d{2}-\d{2}/));
  });
});

// ---------------------------------------------------------------------------
// show command
// ---------------------------------------------------------------------------
describe('show', () => {
  let ws, out;
  const id = '2026.02.24-show-me';

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Show Me', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-06-30', '--goals', 'Show goals', '--description', 'A sample project']));
    silent(() => milestoneCmd.add(ws, ['--id', id, '--name', 'M1', '--due', '2026-04-01']));
    out = captureLog(() => showCmd.run(ws, ['--id', id])).join('\n');
  });
  after(() => cleanup(ws));

  test('displays project name',    () => assert.ok(out.includes('Show Me')));
  test('displays id',              () => assert.ok(out.includes(id)));
  test('displays status',          () => assert.ok(out.includes('active')));
  test('displays startDate',       () => assert.ok(out.includes('2026-02-24')));
  test('displays dueDate',         () => assert.ok(out.includes('2026-06-30')));
  test('displays description',     () => assert.ok(out.includes('A sample project')));
  test('displays milestone name',  () => assert.ok(out.includes('M1')));
  test('displays milestone due',   () => assert.ok(out.includes('2026-04-01')));
  test('displays milestone state', () => assert.ok(out.includes('pending')));

  test('without --id throws', () => {
    assert.throws(() => showCmd.run(ws, []), /--id is required/);
  });
  test('unknown id throws', () => {
    assert.throws(() => showCmd.run(ws, ['--id', 'bad-id']), /not found/);
  });
});

// ---------------------------------------------------------------------------
// tasks command (read)
// ---------------------------------------------------------------------------
describe('tasks (read)', () => {
  let ws;
  const id      = '2026.02.24-tasks-project';
  let projDir, tasksFile;

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Tasks Project', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'Project goals text']));
    projDir   = path.join(ws, 'projects', id);
    tasksFile = path.join(projDir, 'tasks.json');
    // Add a task directly
    const existing = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    existing.tasks.push({
      id: 'task-1', title: 'Do something', description: 'Details here',
      successCriteria: [], workerType: 'node', status: 'pending',
      output: '', learnings: '', completedAt: null,
    });
    fs.writeFileSync(tasksFile, JSON.stringify(existing, null, 2) + '\n');
  });
  after(() => cleanup(ws));

  test('shows project title', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ['--id', id])).join('\n').includes('Tasks Project'));
  });
  test('shows goals/description', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ['--id', id])).join('\n').includes('Project goals text'));
  });
  test('shows task title', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ['--id', id])).join('\n').includes('Do something'));
  });
  test('shows PENDING group', () => {
    assert.ok(captureLog(() => tasksCmd.run(ws, ['--id', id])).join('\n').includes('PENDING'));
  });
  test('--json output matches file content', () => {
    const rawFile = fs.readFileSync(tasksFile, 'utf8').trimEnd();
    assert.strictEqual(captureLog(() => tasksCmd.run(ws, ['--id', id, '--json'])).join('\n'), rawFile);
  });

  test('without --id throws', () => {
    assert.throws(() => tasksCmd.run(ws, []), /--id is required/);
  });
  test('unknown id throws', () => {
    assert.throws(() => tasksCmd.run(ws, ['--id', 'bad-id']), /not found/);
  });

  test('missing tasks.json throws', () => {
    const projDir2 = path.join(ws, 'projects', '2026.02.24-fake');
    fs.mkdirSync(projDir2, { recursive: true });
    const idx = loadIndex(ws);
    idx.projects.push({
      id: '2026.02.24-fake', name: 'Fake', root: 'workspace', rootType: 'local',
      path: projDir2, location: null, startDate: '2026-02-24', dueDate: '2026-12-31',
      completionDate: null, archivedDate: null, status: 'active', description: '', milestones: [],
    });
    saveIndex(ws, idx);
    assert.throws(() => tasksCmd.run(ws, ['--id', '2026.02.24-fake']), /not found/);
  });

  test('invalid JSON tasks.json throws', () => {
    const projDir3 = path.join(ws, 'projects', '2026.02.24-badjson');
    fs.mkdirSync(projDir3, { recursive: true });
    fs.writeFileSync(path.join(projDir3, 'tasks.json'), 'not json');
    const idx2 = loadIndex(ws);
    idx2.projects.push({
      id: '2026.02.24-badjson', name: 'Bad JSON', root: 'workspace', rootType: 'local',
      path: projDir3, location: null, startDate: '2026-02-24', dueDate: '2026-12-31',
      completionDate: null, archivedDate: null, status: 'active', description: '', milestones: [],
    });
    saveIndex(ws, idx2);
    assert.throws(() => tasksCmd.run(ws, ['--id', '2026.02.24-badjson']), /not valid JSON/);
  });
});

// ---------------------------------------------------------------------------
// task add command (write)
// ---------------------------------------------------------------------------
describe('task add', () => {
  let ws;
  const id = '2026.02.24-task-add-project';
  let tasksFile;

  before(() => {
    ws = makeWorkspaceWithConfig();
    silent(() => create.run(ws, ws, ['--name', 'Task Add Project', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g']));
    tasksFile = path.join(ws, 'projects', id, 'tasks.json');
    silent(() => taskCmd.add(ws, [
      '--id', id,
      '--title', 'First Task',
      '--description', 'First task description',
      '--worker-type', 'node',
      '--criteria', 'Criterion A',
      '--criteria', 'Criterion B',
    ]));
  });
  after(() => cleanup(ws));

  test('one task added', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks.length, 1);
  });
  test('task id is task-1', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].id, 'task-1');
  });
  test('task title', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].title, 'First Task');
  });
  test('task description', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].description, 'First task description');
  });
  test('task workerType', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].workerType, 'node');
  });
  test('task status is pending', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].status, 'pending');
  });
  test('task output is empty string', () => {
    assert.strictEqual(JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].output, '');
  });
  test('task successCriteria is array with 2 items', () => {
    const sc = JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks[0].successCriteria;
    assert.ok(Array.isArray(sc));
    assert.strictEqual(sc.length, 2);
    assert.strictEqual(sc[0], 'Criterion A');
    assert.strictEqual(sc[1], 'Criterion B');
  });

  test('second task id auto-increments to task-2', () => {
    silent(() => taskCmd.add(ws, ['--id', id, '--title', 'Second Task', '--description', 'Second description', '--worker-type', 'testing']));
    const tj = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    assert.strictEqual(tj.tasks.length, 2);
    assert.strictEqual(tj.tasks[1].id, 'task-2');
  });

  test('task add without --id throws', () => {
    assert.throws(() => taskCmd.add(ws, ['--title', 'T', '--description', 'd', '--worker-type', 'node']), /--id is required/);
  });
  test('task add without --title throws', () => {
    assert.throws(() => taskCmd.add(ws, ['--id', id, '--description', 'd', '--worker-type', 'node']), /--title is required/);
  });
  test('task add without --description throws', () => {
    assert.throws(() => taskCmd.add(ws, ['--id', id, '--title', 'T', '--worker-type', 'node']), /--description is required/);
  });
  test('task add without --worker-type throws', () => {
    assert.throws(() => taskCmd.add(ws, ['--id', id, '--title', 'T', '--description', 'd']), /--worker-type is required/);
  });
  test('task add unknown project throws', () => {
    assert.throws(() => taskCmd.add(ws, ['--id', 'bad-id', '--title', 'T', '--description', 'd', '--worker-type', 'node']), /not found/);
  });
  test('task add with no --criteria yields empty successCriteria array', () => {
    const wsTmp = makeWorkspaceWithConfig();
    try {
      const nocrId = '2026.02.24-no-criteria';
      silent(() => create.run(wsTmp, wsTmp, ['--name', 'No Criteria', '--root', 'workspace', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'g']));
      silent(() => taskCmd.add(wsTmp, ['--id', nocrId, '--title', 'T', '--description', 'd', '--worker-type', 'node']));
      const sc = JSON.parse(fs.readFileSync(path.join(wsTmp, 'projects', nocrId, 'tasks.json'), 'utf8')).tasks[0].successCriteria;
      assert.ok(Array.isArray(sc));
      assert.strictEqual(sc.length, 0);
    } finally {
      cleanup(wsTmp);
    }
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
    silent(() => create.run(managerWs, agentWs, ['--name', 'Monday Post', '--root', 'local', '--date', '2026-02-24', '--due', '2026-12-31', '--goals', 'Write the post']));
  });

  after(() => {
    cleanup(managerWs);
    cleanup(agentWs);
  });

  test('index is written to manager workspace', () => {
    assert.ok(fs.existsSync(indexPath(managerWs)));
  });
  test('index is NOT written to agent workspace', () => {
    assert.ok(!fs.existsSync(indexPath(agentWs)));
  });
  test('project directory is created in agent workspace', () => {
    assert.ok(fs.existsSync(path.join(agentWs, 'projects', id)));
  });
  test('project directory is NOT created in manager workspace', () => {
    assert.ok(!fs.existsSync(path.join(managerWs, 'projects', id)));
  });
  test('index entry path points into agent workspace', () => {
    const proj = JSON.parse(fs.readFileSync(indexPath(managerWs), 'utf8')).projects[0];
    assert.ok(proj.path.startsWith(agentWs));
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
