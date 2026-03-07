import * as globalIndexMd from '../global-index-md.js';
import { loadConfig, parseLocalDate } from '../config.js';
import * as log from '../logger.js';

const KNOWN_STATUSES = ['active', 'completed', 'archived'];

/**
 * Return today's date as a local Date at midnight (no UTC shift).
 */
function todayLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Compute task count annotation from a project's milestones array.
 * Cancelled tasks are excluded from both numerator and denominator.
 * Returns '' when total is 0.
 *
 * @param {Array} milestones
 * @returns {string} e.g. '3/7 tasks done' or ''
 */
function taskCountAnnotation(milestones) {
  let done  = 0;
  let total = 0;
  for (const ms of (milestones || [])) {
    for (const task of (ms.tasks || [])) {
      if (task.status === 'cancelled') continue;
      total++;
      if (task.status === 'completed') done++;
    }
  }
  return total > 0 ? `${done}/${total} tasks done` : '';
}

/**
 * Compute due-date warning tag for an active project.
 * Returns '[OVERDUE]', '[DUE SOON]', or '' depending on due date.
 *
 * @param {Object} project - project record from global index
 * @param {number} dueSoonDays - warning window (inclusive)
 * @returns {string}
 */
function dueDateTag(project, dueSoonDays) {
  if (project.status !== 'active') return '';
  if (!project.due) return '';
  let dueDate;
  try {
    dueDate = parseLocalDate(project.due);
  } catch {
    return '';
  }
  const today = todayLocal();
  if (dueDate < today) return '[OVERDUE]';
  const windowMs = dueSoonDays * 24 * 60 * 60 * 1000;
  if (dueDate - today <= windowMs) return '[DUE SOON]';
  return '';
}

function run(workspace, agentWorkspace, opts) {
  const projects = globalIndexMd.readGlobalIndex(workspace);

  if (opts.status && !KNOWN_STATUSES.includes(opts.status)) {
    throw new Error(`ERROR: Unknown status '${opts.status}'. Valid values: ${KNOWN_STATUSES.join(', ')}`);
  }

  let filtered = projects;
  if (opts.status) filtered = filtered.filter(p => p.status === opts.status);
  if (opts.root)   filtered = filtered.filter(p => p.root   === opts.root);

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  log.info('projects listed', { count: filtered.length, status: opts.status || 'all', root: opts.root || 'all' });

  if (filtered.length === 0) {
    console.log('No projects found.');
    return;
  }

  // Load config to get dueSoonDays (default 7 if absent)
  let dueSoonDays = 7;
  try {
    const config = loadConfig(workspace);
    dueSoonDays = config.dueSoonDays ?? 7;
  } catch {
    // config may not exist in tests; use default
  }

  const byStatus = { active: [], completed: [], archived: [], unknown: [] };
  for (const p of filtered) {
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
      // rootSection holds the vault/root label used in the global index H2 headings
      const loc   = p.rootSection ? `[${p.rootSection}]` : `[${p.root}]`;
      const count = taskCountAnnotation(p.milestones);
      const tag   = dueDateTag(p, dueSoonDays);

      let rowParts = [`  ${loc} ${p.id}`];
      if (count) rowParts.push(count);
      if (tag)   rowParts.push(tag);

      console.log(rowParts.join(' '));
      if (p.description) console.log(`      ${p.description}`);
      console.log(`      ${p.path}`);
    }
  }
  console.log('');
}

export { run };
