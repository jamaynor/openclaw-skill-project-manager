// ---------------------------------------------------------------------------
// lib/commands/migrate.js
//
// Implements `project-mgmt migrate`:
//   - Walks all configured roots and finds project directories with README.md
//     + tasks.md but no project-index.md
//   - For each: reads README.md (extracts frontmatter if vault project, falls
//     back to plain body for local), reads tasks.md via tasks-md.js parser
//   - Constructs a project-index.md with new UUIDs; existing task IDs become
//     the initial positional code context (new UUIDs are assigned)
//   - Writes project-index.md and removes README.md + tasks.md
//   - Patches any existing project-index.md files missing project-uuid inline
//   - Prints a summary: migrated, skipped, error counts
//   - Does NOT run sweep automatically after migration
// ---------------------------------------------------------------------------

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import {
  loadConfig, loadSharedVaults, expandPath, formatDate,
} from '../config.js';
import * as tasksMd        from '../tasks-md.js';
import * as projectIndexMd from '../project-index-md.js';
import { extractBody } from '../frontmatter.js';
import * as log from '../logger.js';

/**
 * Extract frontmatter fields from README.md content (vault projects).
 * Returns a plain object with any recognized fields.
 *
 * @param {string} content - Raw README.md content.
 * @returns {Object}
 */
function extractReadmeFrontmatter(content) {
  const fm = {};
  const c  = content.replace(/\r\n/g, '\n');
  if (!c.startsWith('---\n')) return fm;

  const endIdx = c.indexOf('\n---\n', 4);
  if (endIdx === -1) return fm;

  const block = c.slice(4, endIdx);
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z][a-z0-9-]*): (.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { fm[key] = JSON.parse(raw); } catch { fm[key] = raw; }
    } else {
      fm[key] = raw;
    }
  }
  return fm;
}

/**
 * Run the migrate command: convert README.md + tasks.md to project-index.md,
 * and patch any existing project-index.md files missing project-uuid.
 *
 * @param {string} workspace - Manager workspace path.
 * @param {string} agentWorkspace - Agent workspace for {agent-workspace} expansion.
 * @param {Object} opts - Commander opts object (unused for migrate beyond workspace resolution).
 */
function run(workspace, agentWorkspace, opts) {
  const config     = loadConfig(workspace);
  const vaultRoots = loadSharedVaults();
  const allRoots   = [...config.roots, ...vaultRoots];

  let migratedCount = 0;
  let skippedCount  = 0;
  let patchedCount  = 0;
  let errorCount    = 0;

  for (const root of allRoots) {
    const rootDir = expandPath(root.path, agentWorkspace);

    let entries = [];
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue; // root dir doesn't exist — skip
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projDir   = path.join(rootDir, entry.name);
      const readmeMd  = path.join(projDir, 'README.md');
      const tasksMdFl = path.join(projDir, 'tasks.md');
      const indexFile = path.join(projDir, 'project-index.md');

      // Already migrated — check if project-uuid is missing and patch if so
      if (fs.existsSync(indexFile)) {
        skippedCount++;
        log.debug('migrate: already has project-index.md — skipped', { path: projDir });

        // Patch missing project-uuid inline
        try {
          const data = projectIndexMd.read(projDir);
          if (!data.frontmatter['project-uuid']) {
            data.frontmatter['project-uuid'] = `p-${crypto.randomUUID()}`;
            projectIndexMd.write(projDir, data);
            patchedCount++;
            console.log(`  Patched project-uuid: ${projDir}`);
            log.info('migrate: patched project-uuid', { path: projDir });
          }
        } catch (err) {
          console.warn(`  WARN: Could not patch project-uuid for ${projDir}: ${err.message}`);
          log.warn('migrate: patch failed', { path: projDir, error: err.message });
        }
        continue;
      }

      // Only migrate directories that have README.md + tasks.md
      if (!fs.existsSync(readmeMd) || !fs.existsSync(tasksMdFl)) {
        continue;
      }

      try {
        migrateProject(projDir, readmeMd, tasksMdFl, root);
        migratedCount++;
        console.log(`  Migrated: ${projDir}`);
        log.info('migrated project', { path: projDir });
      } catch (err) {
        errorCount++;
        console.warn(`  ERROR: Failed to migrate ${projDir}: ${err.message}`);
        log.error('migrate: project failed', { path: projDir, error: err.message });
      }
    }
  }

  // Summary
  console.log('');
  console.log(`Migration complete:`);
  console.log(`  Migrated: ${migratedCount}`);
  console.log(`  Skipped (already has project-index.md): ${skippedCount}`);
  if (patchedCount > 0) console.log(`  Patched project-uuid: ${patchedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log('');
  console.log('Run `project-mgmt sweep` to regenerate the global index.');
}

/**
 * Migrate a single project directory from README.md + tasks.md → project-index.md.
 * Assigns a new project-uuid at migration time.
 *
 * @param {string} projDir - Absolute path to the project directory.
 * @param {string} readmePath - Absolute path to README.md.
 * @param {string} tasksPath - Absolute path to tasks.md.
 * @param {Object} root - The root configuration entry.
 */
function migrateProject(projDir, readmePath, tasksPath, root) {
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  const isVault       = root.type === 'vault';

  // Extract frontmatter from README.md (vault projects have it; local do not)
  const readmeFm   = isVault ? extractReadmeFrontmatter(readmeContent) : {};
  const readmeBody = extractBody(readmeContent);

  // Parse tasks.md via the existing parser
  const tasksData = tasksMd.parse(fs.readFileSync(tasksPath, 'utf8'));

  // Derive a project ID from the directory name (most reliable source)
  const projId = path.basename(projDir);

  // Build the project-index.md data structure
  // Milestones from the old format didn't exist in tasks.md (they were in README frontmatter).
  // We create a single default milestone and put all tasks under it.
  // WHY a single milestone: the old tasks.md had a flat task list with no milestone grouping.
  // We need at least one milestone to hold the tasks in the new structure.
  const milestoneUuid = `m-${crypto.randomUUID()}`;
  const milestoneTasks = (tasksData.tasks || []).map((t, ti) => ({
    id:          `M1-T${ti + 1}`,  // positional placeholder; render recalculates
    uuid:        `t-${crypto.randomUUID()}`,
    title:       t.title,
    status:      t.status === 'cancelled' ? 'cancelled'
               : t.status === 'completed' ? 'completed'
               : 'pending',
    completedAt: t.completedAt || null,
    subtasks:    (t.successCriteria || []).map((sc, si) => ({
      id:          `M1-T${ti + 1}-S${si + 1}`,
      uuid:        `s-${crypto.randomUUID()}`,
      title:       sc,
      status:      t.status === 'completed' ? 'completed' : 'pending',
      completedAt: t.status === 'completed' ? (t.completedAt || null) : null,
    })),
  }));

  const today = formatDate(new Date(), '-');

  const projectData = {
    frontmatter: {
      title:          readmeFm.title || tasksData.title || projId,
      id:             readmeFm.id || projId,
      'project-uuid': `p-${crypto.randomUUID()}`,
      status:         readmeFm.status || 'active',
      tags:           ['project'],
      started:        readmeFm.started || today,
      due:            readmeFm.due || '',
      completed:      readmeFm.completed || '',
      archived:       readmeFm.archived || '',
      description:    readmeFm.description || tasksData.description || '',
      path:           projDir,
      'last-touched': today,
    },
    title:     readmeFm.title || tasksData.title || projId,
    statement: {
      objective: tasksData.description || '',
      lead:      '',
      due:       readmeFm.due || '',
    },
    milestones: milestoneTasks.length > 0
      ? [{
          id:     'M-1',
          uuid:   milestoneUuid,
          name:   'Migrated Tasks',
          status: 'pending',
          tasks:  milestoneTasks,
        }]
      : [],
  };

  // Write project-index.md
  projectIndexMd.write(projDir, projectData);

  // Remove old files
  fs.unlinkSync(readmePath);
  fs.unlinkSync(tasksPath);
}

export { run };
