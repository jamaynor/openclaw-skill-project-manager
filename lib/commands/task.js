import { spawn }           from 'child_process';
import * as globalIndexMd  from '../global-index-md.js';
import * as projectIndexMd from '../project-index-md.js';
import * as log from '../logger.js';
import { acquireLock, releaseLock, indexFilePath, todayStr } from '../project-index-md.js';

function add(workspace, opts) {
  if (!opts.id)          { throw new Error('ERROR: --id is required');          }
  if (!opts.title)       { throw new Error('ERROR: --title is required');        }
  if (!opts.milestone)   { throw new Error('ERROR: --milestone is required');    }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  // --milestone accepts either a UUID ('m-{uuid}') or a positional code ('M-1')
  const newTask = projectIndexMd.addTask(proj.path, opts.milestone, {
    title:       opts.title,
    description: opts.description,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      projectId: opts.id,
      ...newTask,
    }) + '\n');
    return;
  }

  log.info('task added', { projectId: opts.id, taskId: newTask.uuid, title: opts.title });
  console.log(`Task added to ${opts.id} (milestone: ${opts.milestone})`);
  console.log(`   Title: ${opts.title}`);
  console.log(`   UUID:  ${newTask.uuid}`);
}

// ---------------------------------------------------------------------------
// complete: mark a task as done by UUID
// ---------------------------------------------------------------------------

function complete(workspace, opts) {
  if (!opts.id)   { throw new Error('ERROR: --id is required');   }
  if (!opts.task) { throw new Error('ERROR: --task is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const filePath = indexFilePath(proj.path);
  const lockFile = filePath + '.lock';
  const lockFd   = acquireLock(lockFile);
  try {
    const data = projectIndexMd.read(proj.path);

    // Find the task by UUID across all milestones
    let found = null;
    for (const ms of data.milestones) {
      for (const task of ms.tasks) {
        if (task.uuid === opts.task) { found = task; break; }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(`ERROR: Task '${opts.task}' not found in project '${opts.id}'`);
    }

    if (found.status === 'completed') {
      console.warn(`WARN: Task '${opts.task}' is already completed`);
      log.warn('task already completed', { projectId: opts.id, taskUuid: opts.task });
      return;
    }

    found.status      = 'completed';
    found.completedAt = todayStr();

    projectIndexMd.write(proj.path, data);

    log.info('task completed', { projectId: opts.id, taskUuid: opts.task, completedAt: found.completedAt });
    console.log(`Task '${opts.task}' marked complete (${found.completedAt})`);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// update: update task title and/or description by UUID
// ---------------------------------------------------------------------------

function update(workspace, opts) {
  if (!opts.id)   { throw new Error('ERROR: --id is required');   }
  if (!opts.task) { throw new Error('ERROR: --task is required'); }
  if (!opts.title && !opts.description) {
    throw new Error('ERROR: at least one of --title or --description must be provided');
  }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const filePath = indexFilePath(proj.path);
  const lockFile = filePath + '.lock';
  const lockFd   = acquireLock(lockFile);
  try {
    const data = projectIndexMd.read(proj.path);

    let found = null;
    for (const ms of data.milestones) {
      for (const task of ms.tasks) {
        if (task.uuid === opts.task) { found = task; break; }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(`ERROR: Task '${opts.task}' not found in project '${opts.id}'`);
    }

    if (opts.title)       found.title       = opts.title;
    if (opts.description) found.description = opts.description;

    projectIndexMd.write(proj.path, data);

    log.info('task updated', { projectId: opts.id, taskUuid: opts.task });
    console.log(`Task '${opts.task}' updated`);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// cancel: mark a task as cancelled by UUID
// ---------------------------------------------------------------------------

function cancel(workspace, opts) {
  if (!opts.id)   { throw new Error('ERROR: --id is required');   }
  if (!opts.task) { throw new Error('ERROR: --task is required'); }

  const projects = globalIndexMd.readGlobalIndex(workspace);
  const proj     = projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const filePath = indexFilePath(proj.path);
  const lockFile = filePath + '.lock';
  const lockFd   = acquireLock(lockFile);
  try {
    const data = projectIndexMd.read(proj.path);

    let found = null;
    for (const ms of data.milestones) {
      for (const task of ms.tasks) {
        if (task.uuid === opts.task) { found = task; break; }
      }
      if (found) break;
    }
    if (!found) {
      throw new Error(`ERROR: Task '${opts.task}' not found in project '${opts.id}'`);
    }

    if (found.status === 'cancelled') {
      console.warn(`WARN: Task '${opts.task}' is already cancelled`);
      log.warn('task already cancelled', { projectId: opts.id, taskUuid: opts.task });
      return;
    }

    found.status      = 'cancelled';
    found.cancelledAt = todayStr();
    if (opts.reason) found.description = opts.reason;

    projectIndexMd.write(proj.path, data);

    log.info('task cancelled', { projectId: opts.id, taskUuid: opts.task, cancelledAt: found.cancelledAt });
    console.log(`Task '${opts.task}' cancelled (${found.cancelledAt})`);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// addFromEmailTriage: integration seam for email-triage skill.
//
// Spawns `email-triage --json` (or uses the provided spawnFn for testing),
// collects stdout line-by-line, filters for action-required threads, matches
// project_hint to a project in the global index, and adds a task to M-1.
//
// The spawnFn parameter is the dependency injection seam for tests — it
// defaults to the real child_process.spawn.
//
// @param {string} workspace - Manager workspace path.
// @param {Object} opts - Options: { defaultMilestone }
// @param {Function} [spawnFn] - Override spawn for testing (default: spawn from child_process).
// @returns {Promise<{created: number, skipped: number, errors: number}>}
// ---------------------------------------------------------------------------
async function addFromEmailTriage(workspace, opts = {}, spawnFn = spawn) {
  const defaultMilestone = opts.defaultMilestone || 'M-1';
  const projects = globalIndexMd.readGlobalIndex(workspace);

  return new Promise((resolve, reject) => {
    const child = spawnFn('email-triage', ['--json'], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buffer  = '';
    let created = 0;
    let skipped = 0;
    let errors  = 0;

    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop(); // retain incomplete last line

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let thread;
        try {
          thread = JSON.parse(trimmed);
        } catch {
          continue; // skip non-JSON lines
        }

        // Filter: action-required threads only
        if (thread.status !== 'action-required') {
          skipped++;
          continue;
        }

        // Match project_hint against project ids in global index
        const hint    = thread.project_hint || '';
        const project = projects.find(p =>
          p.id === hint ||
          (p.id && p.id.toLowerCase().includes(hint.toLowerCase())) ||
          (hint && p.name && p.name.toLowerCase().includes(hint.toLowerCase()))
        );

        if (!project) {
          log.warn('email-triage: no matching project for hint', { hint });
          skipped++;
          continue;
        }

        const title     = thread.subject || thread.title || 'Untitled task from email';
        const milestone = thread.milestone || defaultMilestone;

        try {
          projectIndexMd.addTask(project.path, milestone, { title });
          log.info('email-triage: task created', { projectId: project.id, title });
          created++;
        } catch (err) {
          log.error('email-triage: failed to add task', { projectId: project.id, error: err.message });
          errors++;
        }
      }
    });

    child.stderr.on('data', chunk => {
      log.warn('email-triage: stderr', { output: chunk.toString().trim() });
    });

    child.on('close', code => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const thread = JSON.parse(buffer.trim());
          if (thread.status === 'action-required') {
            const hint    = thread.project_hint || '';
            const project = projects.find(p =>
              p.id === hint ||
              (p.id && p.id.toLowerCase().includes(hint.toLowerCase())) ||
              (hint && p.name && p.name.toLowerCase().includes(hint.toLowerCase()))
            );
            if (project) {
              const title     = thread.subject || thread.title || 'Untitled task from email';
              const milestone = thread.milestone || defaultMilestone;
              try {
                projectIndexMd.addTask(project.path, milestone, { title });
                created++;
              } catch {
                errors++;
              }
            } else {
              skipped++;
            }
          } else {
            skipped++;
          }
        } catch { /* ignore parse errors */ }
      }

      if (code !== 0 && code !== null) {
        log.warn('email-triage: exited with non-zero code', { code });
      }
      resolve({ created, skipped, errors });
    });

    child.on('error', err => {
      // email-triage not installed — resolve gracefully
      log.warn('email-triage: spawn error', { error: err.message });
      resolve({ created, skipped, errors: errors + 1 });
    });
  });
}

export { add, complete, update, cancel, addFromEmailTriage };
