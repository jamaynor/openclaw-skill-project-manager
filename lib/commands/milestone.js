'use strict';

const fs   = require('fs');
const path = require('path');
const { loadIndex, saveIndex, parseArgs, formatDate, parseLocalDate } = require('../config');
const { setFrontmatter } = require('../frontmatter');
const log = require('../logger');

function syncFrontmatter(proj) {
  if (proj.rootType !== 'vault') return;
  const readmePath = path.join(proj.path, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  const content = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(readmePath, setFrontmatter(content, proj));
}

function add(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id)   { throw new Error('ERROR: --id is required');   }
  if (!opts.name) { throw new Error('ERROR: --name is required'); }
  if (!opts.due)  { throw new Error('ERROR: --due is required');  }
  parseLocalDate(opts.due); // validates; throws on invalid

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  if (!proj.milestones) proj.milestones = [];
  if (proj.milestones.some(m => m.name === opts.name)) {
    throw new Error(`ERROR: Milestone '${opts.name}' already exists in project '${opts.id}'`);
  }

  proj.milestones.push({ name: opts.name, due: opts.due, completedDate: null });
  saveIndex(workspace, index);
  syncFrontmatter(proj);

  log.info('milestone added', { projectId: opts.id, name: opts.name, due: opts.due });
  console.log(`✅ Milestone '${opts.name}' added to ${opts.id} (due ${opts.due})`);
}

function complete(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id)   { throw new Error('ERROR: --id is required');   }
  if (!opts.name) { throw new Error('ERROR: --name is required'); }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  if (!proj.milestones) proj.milestones = [];
  const milestone = proj.milestones.find(m => m.name === opts.name);
  if (!milestone) {
    throw new Error(`ERROR: Milestone '${opts.name}' not found in project '${opts.id}'`);
  }

  if (milestone.completedDate) {
    console.warn(`WARN: Milestone '${opts.name}' is already completed (${milestone.completedDate})`);
    log.warn('milestone already completed', { projectId: opts.id, name: opts.name });
    return;
  }

  milestone.completedDate = formatDate(new Date(), '-');
  saveIndex(workspace, index);
  syncFrontmatter(proj);

  log.info('milestone completed', { projectId: opts.id, name: opts.name, completedDate: milestone.completedDate });
  console.log(`✅ Milestone '${opts.name}' completed (${milestone.completedDate})`);
}

module.exports = { add, complete };
