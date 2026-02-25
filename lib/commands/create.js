'use strict';

const fs   = require('fs');
const path = require('path');
const {
  loadConfig, loadIndex, saveIndex,
  buildProjectId, resolveRoot, expandPath, indexPath, formatDate, slugify,
  parseArgs, parseLocalDate,
} = require('../config');
const { buildFrontmatter } = require('../frontmatter');

function run(workspace, agentWorkspace, args) {
  const opts = parseArgs(args);

  if (!opts.name)  { throw new Error('ERROR: --name is required');  }
  if (!opts.root)  { throw new Error('ERROR: --root is required');  }
  if (!opts.due)   { throw new Error('ERROR: --due is required');   }
  if (!opts.goals) { throw new Error('ERROR: --goals is required'); }

  if (!slugify(opts.name)) {
    throw new Error('ERROR: --name must contain at least one alphanumeric character');
  }

  const config   = loadConfig(workspace);
  const root     = resolveRoot(config, opts.root);
  const date     = opts.date ? parseLocalDate(opts.date) : new Date();
  const dueDate  = parseLocalDate(opts.due);
  const id       = buildProjectId(root, opts.name, date);
  const dir      = expandPath(root.path, agentWorkspace);
  const projDir  = path.join(dir, id);

  // Check for duplicate in index
  const index = loadIndex(workspace);
  if (index.projects.some(p => p.id === id)) {
    throw new Error(`ERROR: Project '${id}' already exists in index`);
  }

  // Create directory
  if (fs.existsSync(projDir)) {
    throw new Error(`ERROR: Project directory already exists: ${projDir}`);
  }
  fs.mkdirSync(projDir, { recursive: true });

  const startDateStr = formatDate(date, '-');
  const dueDateStr   = formatDate(dueDate, '-');

  // Build the index entry (used both for the index and for vault frontmatter)
  const entry = {
    id,
    name:           opts.name,
    root:           root.name,
    rootType:       root.type,
    path:           projDir,
    location:       root.location || null,
    startDate:      startDateStr,
    dueDate:        dueDateStr,
    completionDate: null,
    archivedDate:   null,
    status:         'active',
    description:    opts.description || '',
    milestones:     [],
  };

  // Seed README.md
  const body = [
    `# ${opts.name}`,
    '',
    opts.description || '',
    '',
    `**Started:** ${formatDate(date, '.')}`,
    `**Due:** ${dueDateStr}`,
    `**Root:** ${root.name} (${root.type})`,
    `**ID:** ${id}`,
    '',
    '## Goals',
    '',
    opts.goals,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n') + '\n';

  const readmeContent = root.type === 'vault'
    ? buildFrontmatter(entry) + body
    : body;

  fs.writeFileSync(path.join(projDir, 'README.md'), readmeContent);

  // Seed tasks.json with ralph.js schema; description comes from --goals
  const tasksJson = {
    title:       opts.name,
    description: opts.goals,
    tasks:       [],
  };
  fs.writeFileSync(
    path.join(projDir, 'tasks.json'),
    JSON.stringify(tasksJson, null, 2) + '\n',
  );

  // Update index
  index.projects.push(entry);
  saveIndex(workspace, index);

  console.log(`✅ Created: ${projDir}`);
  console.log(`   ID: ${id}`);
  console.log(`   Index updated: ${indexPath(workspace)}`);
}

module.exports = { run };
