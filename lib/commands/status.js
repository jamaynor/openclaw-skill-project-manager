'use strict';

const { loadIndex, saveIndex } = require('../config');

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id')        opts.id  = args[++i];
    if (args[i] === '--workspace') i++;
  }
  return opts;
}

function run(workspace, args, newStatus) {
  const opts  = parseArgs(args);
  if (!opts.id) { console.error('ERROR: --id is required'); process.exit(1); }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { console.error(`ERROR: Project '${opts.id}' not found in index`); process.exit(1); }

  const prev     = proj.status;
  proj.status    = newStatus;
  const dateKey  = newStatus === 'completed' ? 'completionDate' : 'archivedDate';
  proj[dateKey]  = new Date().toISOString().split('T')[0];

  saveIndex(workspace, index);
  console.log(`✅ ${opts.id}: ${prev} → ${newStatus}`);
}

module.exports = { run };
