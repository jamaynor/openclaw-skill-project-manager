'use strict';

const { loadIndex, parseArgs } = require('../config');
const log = require('../logger');

const KNOWN_STATUSES = ['active', 'completed', 'archived'];

function run(workspace, args) {
  const opts  = parseArgs(args);
  const index = loadIndex(workspace);

  if (opts.status && !KNOWN_STATUSES.includes(opts.status)) {
    throw new Error(`ERROR: Unknown status '${opts.status}'. Valid values: ${KNOWN_STATUSES.join(', ')}`);
  }

  let projects = index.projects;
  if (opts.status) projects = projects.filter(p => p.status === opts.status);
  if (opts.root)   projects = projects.filter(p => p.root   === opts.root);

  if (opts.json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  log.info('projects listed', { count: projects.length, status: opts.status || 'all', root: opts.root || 'all' });

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  const byStatus = { active: [], completed: [], archived: [], unknown: [] };
  for (const p of projects) {
    if (KNOWN_STATUSES.includes(p.status)) {
      byStatus[p.status].push(p);
    } else {
      console.warn(`WARN: Project '${p.id}' has unrecognised status '${p.status}' — shown under UNKNOWN`);
      log.warn('unrecognised project status', { id: p.id, status: p.status });
      byStatus.unknown.push(p);
    }
  }

  for (const [status, list] of Object.entries(byStatus)) {
    if (list.length === 0) continue;
    console.log(`\n${status.toUpperCase()} (${list.length})`);
    for (const p of list) {
      const loc = p.location ? `[${p.location}]` : `[${p.rootType}]`;
      console.log(`  ${loc} ${p.id}`);
      if (p.description) console.log(`      ${p.description}`);
      console.log(`      ${p.path}`);
    }
  }
  console.log('');
}

module.exports = { run };
