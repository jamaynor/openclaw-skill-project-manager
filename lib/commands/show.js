import * as globalIndexMd from '../global-index-md.js';
import * as projectIndexMd from '../project-index-md.js';
import * as log from '../logger.js';

function run(workspace, agentWorkspace, opts) {
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  // --json: emit the full live project record from project-index.md
  if (opts.json) {
    const data = projectIndexMd.read(proj.path);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  log.info('project shown', { id: opts.id });

  // For milestones: read them from the project-index.md if it exists (live data).
  // Fall back to global index milestones if the project file is unavailable.
  // WHY prefer live file: the global index may be stale between sweeps.
  let milestones = proj.milestones || [];
  if (proj.path) {
    try {
      const live = projectIndexMd.read(proj.path);
      milestones = live.milestones || [];
    } catch {
      // Project file missing or malformed — use global index data
    }
  }

  console.log('');
  console.log(`Project: ${proj.name}`);
  console.log(`ID:      ${proj.id}`);
  console.log(`Status:  ${proj.status}`);
  console.log(`Root:    ${proj.root} [${proj.rootSection || ''}]`);
  console.log(`Path:    ${proj.path}`);
  console.log('');
  console.log(`Started:   ${proj.started}`);
  console.log(`Due:       ${proj.due || '—'}`);
  console.log(`Completed: ${proj.completed || '—'}`);
  console.log(`Archived:  ${proj.archived  || '—'}`);
  if (proj.description) {
    console.log('');
    console.log(`Description: ${proj.description}`);
  }
  console.log('');
  if (milestones.length === 0) {
    console.log('Milestones: none');
  } else {
    console.log('Milestones:');
    for (const m of milestones) {
      // Determine display status for milestone
      const allDone    = m.tasks.length > 0 && m.tasks.every(t => t.status === 'completed');
      const stateLabel = allDone ? 'done' : 'pending';
      console.log(`  - ${m.name}  [${stateLabel}]`);
    }
  }
  console.log('');
}

export { run };
