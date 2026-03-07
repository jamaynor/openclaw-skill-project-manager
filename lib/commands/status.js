import { formatDate } from '../config.js';
import * as globalIndexMd  from '../global-index-md.js';
import * as projectIndexMd from '../project-index-md.js';
import * as log from '../logger.js';

function run(workspace, agentWorkspace, opts, newStatus) {
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found in index`); }

  // Read the current status from the live project-index.md (authoritative).
  // WHY: the global index can be stale between sweeps. The live file always
  // reflects the most recent state — use it for the already-completed check.
  let currentStatus = proj.status;
  if (proj.path) {
    try {
      const liveData = projectIndexMd.read(proj.path);
      currentStatus  = liveData.frontmatter.status || currentStatus;
    } catch {
      // Fall back to global index status if the file is unavailable
    }
  }

  if (currentStatus === newStatus) {
    console.warn(`WARN: Project '${opts.id}' is already ${newStatus}`);
    log.warn('already at target status', { id: opts.id, status: newStatus });
    return;
  }

  const prev    = currentStatus;
  const dateStr = formatDate(new Date(), '-');

  // Update the live project-index.md file for ALL root types.
  // WHY no vault-only guard: the new format is uniform — every project has a
  // project-index.md regardless of root type. The old guard was needed because
  // local projects only had tasks.md (no frontmatter). That distinction is gone.
  if (proj.path) {
    try {
      const data = projectIndexMd.read(proj.path);
      data.frontmatter.status = newStatus;
      if (newStatus === 'completed') {
        data.frontmatter.completed = dateStr;
      } else if (newStatus === 'archived') {
        data.frontmatter.archived = dateStr;
      }
      // write() automatically updates last-touched
      projectIndexMd.write(proj.path, data);
    } catch (err) {
      console.warn(`WARN: Could not update project-index.md for ${opts.id}: ${err.message}`);
      log.warn('project-index.md update failed', { id: opts.id, error: err.message });
    }
  }

  log.info('status changed', { id: opts.id, from: prev, to: newStatus });
  console.log(`${opts.id}: ${prev} → ${newStatus}`);
}

export { run };
