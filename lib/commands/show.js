'use strict';

const { loadIndex, parseArgs } = require('../config');
const log = require('../logger');

function run(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  log.info('project shown', { id: opts.id });
  console.log('');
  console.log(`Project: ${proj.name}`);
  console.log(`ID:      ${proj.id}`);
  console.log(`Status:  ${proj.status}`);
  console.log(`Root:    ${proj.root} (${proj.rootType})`);
  console.log(`Path:    ${proj.path}`);
  console.log('');
  console.log(`Started:   ${proj.startDate}`);
  console.log(`Due:       ${proj.dueDate || '—'}`);
  console.log(`Completed: ${proj.completionDate || '—'}`);
  console.log(`Archived:  ${proj.archivedDate   || '—'}`);
  if (proj.description) {
    console.log('');
    console.log(`Description: ${proj.description}`);
  }
  const milestones = proj.milestones || [];
  console.log('');
  if (milestones.length === 0) {
    console.log('Milestones: none');
  } else {
    console.log('Milestones:');
    for (const m of milestones) {
      const done = m.completedDate ? `done: ${m.completedDate}` : 'pending';
      console.log(`  - ${m.name}  due: ${m.due}  [${done}]`);
    }
  }
  console.log('');
}

module.exports = { run };
