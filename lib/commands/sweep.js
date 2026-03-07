// ---------------------------------------------------------------------------
// lib/commands/sweep.js
//
// Implements `project-mgmt sweep`:
//   - Walks all configured roots (local + vault)
//   - Collects every project-index.md found in immediate subdirectories
//   - Writes a new yyyy.mm.dd-global-project-index.md to {workspace}/projects/
//   - Overwrites today's file if it already exists (idempotent re-runs)
//   - Skips malformed files with a warning; does not abort
// ---------------------------------------------------------------------------

import fs   from 'fs';
import path from 'path';
import {
  loadConfig, loadSharedVaults, expandPath, formatDate,
} from '../config.js';
import * as projectIndexMd from '../project-index-md.js';
import { renderProjectEntry } from '../global-index-md.js';
import * as log from '../logger.js';

/**
 * Run the sweep command: aggregate all project-index.md files into a dated
 * global index file.
 *
 * @param {string} workspace - Manager workspace path.
 * @param {string} agentWorkspace - Agent workspace for {agent-workspace} expansion.
 * @param {Object} opts - Commander opts object (unused for sweep, but passed for consistency).
 */
function run(workspace, agentWorkspace, opts) {
  const config      = loadConfig(workspace);
  const vaultRoots  = loadSharedVaults();
  const allRoots    = [...config.roots, ...vaultRoots];

  // Collect (rootEntry, projectData) pairs from all roots
  const collected = [];
  let   skipped   = 0;

  for (const root of allRoots) {
    const rootDir = expandPath(root.path, agentWorkspace);

    // List immediate subdirectories of this root
    let entries = [];
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      // Root dir doesn't exist or is unreadable — skip silently
      log.debug('sweep: root dir unreadable', { root: root.name, path: rootDir });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projDir   = path.join(rootDir, entry.name);
      const indexFile = path.join(projDir, 'project-index.md');

      if (!fs.existsSync(indexFile)) continue;

      try {
        const data = projectIndexMd.read(projDir);
        collected.push({ root, data });
      } catch (err) {
        console.warn(`WARN: Skipping malformed project-index.md at ${projDir}: ${err.message}`);
        log.warn('sweep: skipped malformed project-index.md', { path: projDir, error: err.message });
        skipped++;
      }
    }
  }

  // Build the global index content
  const today      = formatDate(new Date(), '-');
  const todayDot   = today.replace(/-/g, '.');
  const lines      = [`# Global Project Index — ${today}`, ''];

  // Group by root label/name for H2 sections
  // WHY group by root: the global index organizes projects by their vault/root
  // for easy scanning in Obsidian.
  const byRoot = new Map();
  for (const { root, data } of collected) {
    const sectionName = root.label || root.name;
    if (!byRoot.has(sectionName)) byRoot.set(sectionName, []);
    byRoot.get(sectionName).push({ root, data });
  }

  for (const [sectionName, projects] of byRoot) {
    lines.push(`## ${sectionName}`);
    lines.push('');
    for (const { root, data } of projects) {
      const entryLines = renderProjectEntry(data, root.label || root.name);
      lines.push(...entryLines);
    }
  }

  const content   = lines.join('\n');
  const outputDir = path.join(workspace, 'projects');
  const outFile   = path.join(outputDir, `${todayDot}-global-project-index.md`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outFile, content);

  log.info('sweep complete', { output: outFile, count: collected.length, skipped });
  console.log(`Sweep complete: ${collected.length} project(s) indexed`);
  if (skipped > 0) console.log(`  Skipped (malformed): ${skipped}`);
  console.log(`  Output: ${outFile}`);
}

export { run };
