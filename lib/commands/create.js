'use strict';

const fs   = require('fs');
const path = require('path');
const {
  loadConfig, loadIndex, saveIndex,
  buildProjectId, resolveRoot, expandPath,
} = require('../config');

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name')        opts.name        = args[++i];
    if (args[i] === '--root')        opts.root        = args[++i];
    if (args[i] === '--description') opts.description = args[++i];
    if (args[i] === '--date')        opts.date        = args[++i];
    if (args[i] === '--workspace')   i++; // already consumed
  }
  return opts;
}

function run(workspace, args) {
  const opts = parseArgs(args);

  if (!opts.name) { console.error('ERROR: --name is required'); process.exit(1); }
  if (!opts.root) { console.error('ERROR: --root is required'); process.exit(1); }

  const config = loadConfig(workspace);
  const root   = resolveRoot(config, opts.root);
  const date   = opts.date ? new Date(opts.date) : new Date();
  const id     = buildProjectId(root, opts.name, date);
  const dir    = expandPath(root.path, workspace);
  const projDir = path.join(dir, id);

  // Create directory
  if (fs.existsSync(projDir)) {
    console.error(`ERROR: Project directory already exists: ${projDir}`);
    process.exit(1);
  }
  fs.mkdirSync(projDir, { recursive: true });

  // Seed a README in the project directory
  const readme = [
    `# ${opts.name}`,
    '',
    opts.description ? `${opts.description}` : '',
    '',
    `**Started:** ${date.toISOString().split('T')[0]}`,
    `**Root:** ${root.name} (${root.type})`,
    `**ID:** ${id}`,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
  fs.writeFileSync(path.join(projDir, 'README.md'), readme + '\n');

  // Update index
  const index = loadIndex(workspace);
  index.projects.push({
    id,
    name:           opts.name,
    root:           root.name,
    rootType:       root.type,
    path:           projDir,
    location:       root.location || null,
    startDate:      date.toISOString().split('T')[0],
    completionDate: null,
    archivedDate:   null,
    status:         'active',
    description:    opts.description || '',
  });
  saveIndex(workspace, index);

  console.log(`✅ Created: ${projDir}`);
  console.log(`   ID: ${id}`);
  console.log(`   Index updated: ${require('../config').indexPath(workspace)}`);
}

module.exports = { run };
