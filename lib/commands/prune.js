// ---------------------------------------------------------------------------
// lib/commands/prune.js
//
// Implements `project-mgmt prune`:
//   - Enumerates dated global index files in {workspace}/projects/ matching
//     GLOBAL_INDEX_PATTERN
//   - Files whose date portion is older than --days (default 30) are candidates
//   - For each candidate: copy to PARA vault archive path then delete
//   - Prints a summary: archived, deleted, retained, errors
//   - Acts immediately — no dry-run mode
// ---------------------------------------------------------------------------

import fs   from 'fs';
import path from 'path';
import {
  loadConfig, loadSharedVaults, GLOBAL_INDEX_PATTERN,
} from '../config.js';
import * as log from '../logger.js';

/**
 * Parse a dated global index filename date portion (yyyy.mm.dd) into a local Date.
 * Returns null if the filename does not match the expected pattern.
 *
 * @param {string} filename - e.g. '2026.03.07-global-project-index.md'
 * @returns {Date|null}
 */
function parseDateFromFilename(filename) {
  const m = filename.match(/^(\d{4})\.(\d{2})\.(\d{2})-/);
  if (!m) return null;
  const y  = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d  = Number(m[3]);
  return new Date(y, mo, d);
}

/**
 * Derive the PARA archive directory for global indexes.
 * Uses the first configured vault root (from system-config).
 * Returns null if no vault is configured.
 *
 * @param {Object} config - Loaded hal-project-manager.json config.
 * @returns {string|null}
 */
function archiveDir(config) {
  const vaultRoots = loadSharedVaults();
  if (vaultRoots.length > 0) {
    // Use the vault path root (strip the '/1-Projects' suffix if present)
    const vaultPath = vaultRoots[0].path.replace(/\/1-Projects\/?$/, '');
    return path.join(vaultPath, '4-Archive', 'global-indexes');
  }
  return null;
}

/**
 * Run the prune command.
 *
 * @param {string} workspace - Manager workspace path.
 * @param {string} agentWorkspace - Agent workspace (unused but consistent with other commands).
 * @param {Object} opts - Commander opts; opts.days is the retention window (default '30').
 */
function run(workspace, agentWorkspace, opts) {
  const days = parseInt(opts.days ?? '30', 10);
  if (isNaN(days) || days < 0) {
    throw new Error(`ERROR: --days must be a non-negative integer, got '${opts.days}'`);
  }

  const projectsDir = path.join(workspace, 'projects');

  // Enumerate all candidate files
  let files = [];
  try {
    files = fs.readdirSync(projectsDir).filter(f => GLOBAL_INDEX_PATTERN.test(f));
  } catch {
    console.log('No projects directory found — nothing to prune.');
    return;
  }

  if (files.length === 0) {
    console.log('No dated global index files found — nothing to prune.');
    return;
  }

  // Compute the cutoff date: today minus `days` days
  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff  = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);

  // Load config to get vault root for archive path
  let config;
  try {
    config = loadConfig(workspace);
  } catch {
    config = null;
  }

  const destDir = archiveDir(config);

  let archivedCount = 0;
  let deletedCount  = 0;
  let retainedCount = 0;
  const errors      = [];

  for (const filename of files) {
    const fileDate = parseDateFromFilename(filename);
    if (!fileDate || fileDate >= cutoff) {
      retainedCount++;
      continue;
    }

    // This file is a candidate for pruning
    const srcPath = path.join(projectsDir, filename);

    try {
      // Archive step
      if (destDir) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcPath, path.join(destDir, filename));
        archivedCount++;
        log.debug('prune: archived global index', { file: filename, dest: destDir });
      } else {
        console.warn(`WARN: No vault configured — skipping archive for ${filename}`);
        log.warn('prune: no vault for archive', { file: filename });
      }

      // Delete step
      fs.unlinkSync(srcPath);
      deletedCount++;
      log.info('prune: deleted global index', { file: filename });
    } catch (err) {
      errors.push({ file: filename, error: err.message });
      log.error('prune: error processing file', { file: filename, error: err.message });
    }
  }

  // Summary
  console.log('');
  console.log('Prune complete:');
  console.log(`  Archived: ${archivedCount}`);
  console.log(`  Deleted:  ${deletedCount}`);
  console.log(`  Retained: ${retainedCount}`);
  if (errors.length > 0) {
    console.log(`  Errors:   ${errors.length}`);
    for (const { file, error } of errors) {
      console.warn(`    ${file}: ${error}`);
    }
  }
  console.log('');
}

export { run };
