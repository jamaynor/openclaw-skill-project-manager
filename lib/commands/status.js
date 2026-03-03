'use strict';

const fs   = require('fs');
const path = require('path');
const { loadIndex, saveIndex, formatDate, parseArgs } = require('../config');
const { setFrontmatter } = require('../frontmatter');
const log = require('../logger');

function run(workspace, args, newStatus) {
  const opts  = parseArgs(args);
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found in index`); }

  if (proj.status === newStatus) {
    console.warn(`WARN: Project '${opts.id}' is already ${newStatus}`);
    log.warn('already at target status', { id: opts.id, status: newStatus });
    return;
  }

  const prev    = proj.status;
  proj.status   = newStatus;
  const dateKey = newStatus === 'completed' ? 'completionDate' : 'archivedDate';
  proj[dateKey] = formatDate(new Date(), '-');
  // Note: when archiving a completed project, completionDate is intentionally preserved.
  // Only the relevant dateKey is written; the other date field is left unchanged.
  // The frontmatter sync below passes the full proj object, so both dates appear in YAML.

  saveIndex(workspace, index);

  // Sync frontmatter for vault projects
  if (proj.rootType === 'vault') {
    const readmePath = path.join(proj.path, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        const content = fs.readFileSync(readmePath, 'utf8');
        fs.writeFileSync(readmePath, setFrontmatter(content, proj));
      } catch (err) {
        console.warn(`WARN: Could not sync frontmatter for ${opts.id}: ${err.message}`);
        log.warn('frontmatter sync failed', { id: opts.id, error: err.message });
      }
    }
  }

  log.info('status changed', { id: opts.id, from: prev, to: newStatus });
  console.log(`✅ ${opts.id}: ${prev} → ${newStatus}`);
}

module.exports = { run };
