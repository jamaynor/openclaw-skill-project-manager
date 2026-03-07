import crypto from 'crypto';
import * as globalIndexMd  from '../global-index-md.js';
import * as projectIndexMd from '../project-index-md.js';
import { acquireLock, releaseLock, indexFilePath, todayStr } from '../project-index-md.js';
import * as log from '../logger.js';

// ---------------------------------------------------------------------------
// blocker add: add a new blocker to a project's ## Blockers section
// ---------------------------------------------------------------------------

function add(workspace, opts) {
  if (!opts.id)          { throw new Error('ERROR: --id is required');          }
  if (!opts.description) { throw new Error('ERROR: --description is required'); }
  if (!opts.waitingOn)   { throw new Error('ERROR: --waiting-on is required');  }
  if (!opts.affects)     { throw new Error('ERROR: --affects is required');     }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const filePath = indexFilePath(proj.path);
  const lockFile = filePath + '.lock';
  const lockFd   = acquireLock(lockFile);
  try {
    const data = projectIndexMd.read(proj.path);

    // Ensure blockers array exists
    if (!data.blockers) data.blockers = [];

    // Parse affects: comma-separated list of UUIDs (m-{uuid} or t-{uuid})
    const affectUuids = opts.affects.split(',').map(s => s.trim()).filter(Boolean);

    // Resolve each UUID to its display handle
    const resolvedHandles = [];
    for (const uuid of affectUuids) {
      const handle = resolveUuidToHandle(data, uuid);
      if (!handle) {
        throw new Error(`ERROR: UUID '${uuid}' not found in project '${opts.id}'`);
      }
      resolvedHandles.push(handle);
    }

    const newUuid = `b-${crypto.randomUUID()}`;
    const newBlocker = {
      uuid:        newUuid,
      description: opts.description,
      waitingOn:   opts.waitingOn,
      since:       todayStr(),
      affects:     resolvedHandles,
      resolvedAt:  null,
      status:      'open',
    };

    data.blockers.push(newBlocker);
    projectIndexMd.write(proj.path, data);

    log.info('blocker added', { projectId: opts.id, uuid: newUuid, description: opts.description });
    console.log(`Blocker added to ${opts.id}`);
    console.log(`   UUID:  ${newUuid}`);
    console.log(`   Desc:  ${opts.description}`);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// blocker resolve: mark a blocker as resolved by UUID
// ---------------------------------------------------------------------------

function resolve(workspace, opts) {
  if (!opts.id)      { throw new Error('ERROR: --id is required');      }
  if (!opts.blocker) { throw new Error('ERROR: --blocker is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const filePath = indexFilePath(proj.path);
  const lockFile = filePath + '.lock';
  const lockFd   = acquireLock(lockFile);
  try {
    const data = projectIndexMd.read(proj.path);

    if (!data.blockers || data.blockers.length === 0) {
      throw new Error(`ERROR: Blocker '${opts.blocker}' not found in project '${opts.id}'`);
    }

    const blocker = data.blockers.find(b => b.uuid === opts.blocker);
    if (!blocker) {
      throw new Error(`ERROR: Blocker '${opts.blocker}' not found in project '${opts.id}'`);
    }

    if (blocker.status === 'resolved') {
      console.warn(`WARN: Blocker '${opts.blocker}' is already resolved`);
      log.warn('blocker already resolved', { projectId: opts.id, blockerUuid: opts.blocker });
      return;
    }

    blocker.status     = 'resolved';
    blocker.resolvedAt = todayStr();
    blocker.affects    = []; // resolved blockers carry no affects list

    projectIndexMd.write(proj.path, data);

    log.info('blocker resolved', { projectId: opts.id, blockerUuid: opts.blocker, resolvedAt: blocker.resolvedAt });
    console.log(`Blocker '${opts.blocker}' resolved (${blocker.resolvedAt})`);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// Internal helper: resolve a UUID to its display handle
// ---------------------------------------------------------------------------

/**
 * Look up a milestone or task UUID in the project data and return its
 * full display handle string: [positional] Name (id:{uuid})
 *
 * @param {Object} data - Parsed project data.
 * @param {string} uuid - The UUID to look up (m-{uuid} or t-{uuid}).
 * @returns {string|null} Display handle or null if not found.
 */
function resolveUuidToHandle(data, uuid) {
  if (uuid.startsWith('m-')) {
    // Look up a milestone
    const milestones = data.milestones || [];
    for (let mi = 0; mi < milestones.length; mi++) {
      const ms = milestones[mi];
      if (ms.uuid === uuid) {
        const msPos = `M-${mi + 1}`;
        return `[${msPos}] ${ms.name} (id:${ms.uuid})`;
      }
    }
  } else if (uuid.startsWith('t-')) {
    // Look up a task across all milestones
    const milestones = data.milestones || [];
    for (let mi = 0; mi < milestones.length; mi++) {
      const ms    = milestones[mi];
      const tasks = ms.tasks || [];
      for (let ti = 0; ti < tasks.length; ti++) {
        const task = tasks[ti];
        if (task.uuid === uuid) {
          const taskPos = `M${mi + 1}-T${ti + 1}`;
          return `[${taskPos}] ${task.title} (id:${task.uuid})`;
        }
      }
    }
  }
  return null;
}

export { add, resolve };
