import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import {
  loadConfig, globalIndexPath,
  buildProjectId, resolveRoot, expandPath, formatDate, slugify,
  parseLocalDate,
} from '../config.js';
import * as projectIndexMd from '../project-index-md.js';
import * as globalIndexMd  from '../global-index-md.js';
import * as log from '../logger.js';

function run(workspace, agentWorkspace, opts) {
  if (!slugify(opts.name)) {
    throw new Error('ERROR: --name must contain at least one alphanumeric character');
  }
  if (!opts.due) {
    throw new Error('ERROR: --due is required');
  }
  if (!opts.goals) {
    throw new Error('ERROR: --goals is required');
  }

  const config   = loadConfig(workspace);
  const root     = resolveRoot(config, opts.root);
  const date     = opts.date ? parseLocalDate(opts.date) : new Date();
  const dueDate  = parseLocalDate(opts.due);
  const id       = buildProjectId(root, opts.name, date);
  const dir      = expandPath(root.path, agentWorkspace);
  const projDir  = path.join(dir, id);

  // Check for duplicate in the global index (replaces old loadIndex check)
  const existingProjects = globalIndexMd.readGlobalIndex(workspace);
  if (existingProjects.some(p => p.id === id)) {
    throw new Error(`ERROR: Project '${id}' already exists in index`);
  }

  if (fs.existsSync(projDir)) {
    throw new Error(`ERROR: Project directory already exists: ${projDir}`);
  }

  log.debug('creating project', { name: opts.name, root: opts.root, date: opts.date });

  const startDateStr  = formatDate(date, '-');
  const dueDateStr    = formatDate(dueDate, '-');
  const projectUuid   = `p-${crypto.randomUUID()}`;

  // Build the structured project data for project-index.md
  // WHY one file: the new format combines frontmatter + statement + tasks
  // into a single project-index.md, replacing README.md + tasks.md.
  const projectData = {
    frontmatter: {
      title:          opts.name,
      id,
      'project-uuid': projectUuid,
      status:         'active',
      tags:           ['project'],
      started:        startDateStr,
      due:            dueDateStr,
      completed:      '',
      archived:       '',
      description:    opts.description || '',
      path:           projDir,
      'last-touched': projectIndexMd.todayStr(),
    },
    title:      opts.name,
    statement:  {
      objective: opts.goals,
      lead:      '',
      due:       dueDateStr,
    },
    milestones: [],
  };

  // Append to global index first — if this fails no filesystem changes have been made.
  // WHY index-first: this preserves the rollback-on-failure pattern from the
  // original create.js. If filesystem creation fails after the index append,
  // we can roll back the index entry cleanly.
  const rootName = root.label || root.name;
  globalIndexMd.appendProjectToGlobalIndex(workspace, projectData, rootName);

  // Now create the project directory and write project-index.md
  try {
    fs.mkdirSync(projDir, { recursive: true });
    projectIndexMd.write(projDir, projectData);
  } catch (err) {
    log.error('failed to create project files', { id, error: err.message });

    // Roll back the global index append
    globalIndexMd.rollbackProjectFromGlobalIndex(workspace, id);

    try { fs.rmSync(projDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    throw new Error(`ERROR: Failed to create project files: ${err.message}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      id,
      name:           opts.name,
      root:           root.name,
      rootType:       root.type,
      path:           projDir,
      started:        startDateStr,
      due:            dueDateStr,
      status:         'active',
      description:    opts.description || '',
      indexPath:      globalIndexPath(workspace),
    }) + '\n');
    return;
  }

  log.info('project created', { id, root: root.name, path: projDir });
  console.log(`Created: ${projDir}`);
  console.log(`   ID: ${id}`);
  console.log(`   Index updated: ${globalIndexPath(workspace)}`);
}

export { run };
