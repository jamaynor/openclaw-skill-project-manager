'use strict';

const { loadIndex } = require('../config');

function parseArgs(args) {
  const opts = { status: null, root: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status')    opts.status = args[++i];
    if (args[i] === '--root')      opts.root   = args[++i];
    if (args[i] === '--workspace') i++;
  }
  return opts;
}

function run(workspace, args) {
  const opts  = parseArgs(args);
  const index = loadIndex(workspace);

  let projects = index.projects;
  if (opts.status) projects = projects.filter(p => p.status === opts.status);
  if (opts.root)   projects = projects.filter(p => p.root   === opts.root);

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  const byStatus = { active: [], completed: [], archived: [] };
  for (const p of projects) {
    (byStatus[p.status] || byStatus.active).push(p);
  }

  for (const [status, list] of Object.entries(byStatus)) {
    if (list.length === 0) continue;
    console.log(`\n${status.toUpperCase()} (${list.length})`);
    for (const p of list) {
      const loc = p.location ? `[${p.location}]` : `[${p.rootType}]`;
      console.log(`  ${loc} ${p.id}`);
      if (p.description) console.log(`       ${p.description}`);
      console.log(`       ${p.path}`);
    }
  }
  console.log('');
}

module.exports = { run };
