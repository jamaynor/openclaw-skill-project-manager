import * as globalIndexMd  from '../global-index-md.js';
import * as projectIndexMd from '../project-index-md.js';
import * as log from '../logger.js';

const STATUS_ORDER = ['in-progress', 'pending', 'completed', 'cancelled'];

function run(workspace, agentWorkspace, opts) {
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  // Read from the live project-index.md — always authoritative
  const data = projectIndexMd.read(proj.path);

  // Flatten all tasks across all milestones for display.
  // WHY flatten: the output format is unchanged from the old tasks.md-based
  // output — tasks grouped by status. Callers don't need to know which
  // milestone each task belongs to in the summary view.
  const allTasks = [];
  for (const ms of (data.milestones || [])) {
    for (const task of (ms.tasks || [])) {
      allTasks.push({ ...task, milestoneName: ms.name, milestoneId: ms.id });
    }
  }

  log.info('tasks listed', { id: opts.id, count: allTasks.length });

  if (opts.json) {
    // Output JSON with milestones structure preserved (more useful than flat array)
    console.log(JSON.stringify({
      title:      data.title,
      milestones: data.milestones,
    }, null, 2));
    return;
  }

  // Human-readable output — mirrors the old tasks command format
  console.log('');
  console.log(`Project: ${data.title}`);
  const objective = (data.statement || {}).objective;
  if (objective) console.log(`Goals:   ${objective}`);
  console.log('');

  if (allTasks.length === 0) {
    console.log('No tasks.');
    return;
  }

  // Group by status
  const groups = {};
  for (const t of allTasks) {
    const s = t.status || 'unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(t);
  }

  const seen = new Set();
  for (const s of STATUS_ORDER) {
    if (!groups[s]) continue;
    seen.add(s);
    console.log(`${s.toUpperCase()} (${groups[s].length})`);
    for (const t of groups[s]) {
      console.log(`  [${t.id}] ${t.title}`);
      if (t.milestoneName) console.log(`        milestone: ${t.milestoneName}`);
    }
    console.log('');
  }

  // Any unrecognized statuses
  for (const [s, list] of Object.entries(groups)) {
    if (seen.has(s)) continue;
    console.log(`${s.toUpperCase()} (${list.length})`);
    for (const t of list) console.log(`  [${t.id}] ${t.title}`);
    console.log('');
  }
}

export { run };
