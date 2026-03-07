// ---------------------------------------------------------------------------
// lib/global-index-md.js
//
// Parser and writer for the dated global project index file:
//   yyyy.mm.dd-global-project-index.md
//
// File structure:
//   # Global Project Index — YYYY-MM-DD
//
//   ## Root Name
//
//   ### Project Title
//   - id: project-id
//   - status: active
//   - path: /absolute/path
//   - started: YYYY-MM-DD
//   - due: YYYY-MM-DD
//   - completed: ""
//   - archived: ""
//   - description: "..."
//   - root: root-name
//
//   #### M-1: Milestone Name (id:m-{uuid})
//   - [ ] M1-T1: Task Name (id:t-{uuid})
//     - [ ] M1-T1-S1: Subtask Name (id:s-{uuid})
//
//   - [ ] [B-1] Blocker desc (id:b-{uuid}) waiting-on:"..." since:YYYY-MM-DD affects:[M-1] Name (id:m-...)
//
// WHY a separate module: the global index has a different structure from
// per-project files — it aggregates multiple projects across multiple roots
// into a single file with an H2-per-root, H3-per-project layout. Keeping
// it separate from project-index-md.js keeps each module focused on one
// responsibility (SOLID: Single Responsibility).
// ---------------------------------------------------------------------------

import fs   from 'fs';
import path from 'path';
import { globalIndexPath, formatDate } from './config.js';
import * as log from './logger.js';

// ---------------------------------------------------------------------------
// Parse the global index file into an array of project records.
//
// Each record has the shape:
//   {
//     id: string,
//     name: string,       // from the H3 heading
//     status: string,
//     path: string,
//     started: string,
//     due: string,
//     completed: string,
//     archived: string,
//     description: string,
//     root: string,
//     rootSection: string,  // the H2 section name (vault/root label)
//     milestones: [...]     // same structure as project-index-md parse output
//   }
//
// WHY flat array output: list.js and show.js need a flat list to filter and
// display. The root section is preserved as a field for display purposes
// but callers don't need to navigate nested sections.
// ---------------------------------------------------------------------------

/**
 * Parse a global project index markdown file into a flat array of project records.
 *
 * @param {string} content - Raw file content.
 * @returns {Array<Object>} Flat array of project records.
 */
function parse(content) {
  const lines   = content.replace(/\r\n/g, '\n').split('\n');
  const projects = [];

  let currentRoot    = '';
  let currentProject = null;
  let inMilestone    = false;
  let currentMs      = null;
  let currentTask    = null;

  // Regex patterns used in the parsing loop
  const rootRe      = /^## (.+)$/;
  const projRe      = /^### (.+)$/;
  const metaRe      = /^- ([a-z][a-z-]*): (.*)$/;
  const milestoneRe = /^#### ([A-Z]-\d+): (.+?) \(id:(m-[0-9a-f-]+)\)(.*)$/;
  const taskRe      = /^- \[([ x\-])\] ([A-Z0-9]+-T\d+): (.+?) \(id:(t-[0-9a-f-]+)\)(.*)?$/;
  const subtaskRe   = /^  - \[([ x\-])\] ([A-Z0-9]+-T\d+-S\d+): (.+?) \(id:(s-[0-9a-f-]+)\)(.*)?$/;

  for (const line of lines) {
    // H2: root/vault section
    const rootMatch = line.match(rootRe);
    if (rootMatch) {
      // Flush current project
      if (currentProject) {
        if (currentTask && currentMs) currentMs.tasks.push(currentTask);
        if (currentMs) currentProject.milestones.push(currentMs);
        projects.push(currentProject);
      }
      currentRoot    = rootMatch[1].trim();
      currentProject = null;
      currentMs      = null;
      currentTask    = null;
      inMilestone    = false;
      continue;
    }

    // H3: project section
    const projMatch = line.match(projRe);
    if (projMatch) {
      // Flush current project
      if (currentProject) {
        if (currentTask && currentMs) currentMs.tasks.push(currentTask);
        if (currentMs) currentProject.milestones.push(currentMs);
        projects.push(currentProject);
      }
      currentProject = {
        name:        projMatch[1].trim(),
        id:          '',
        status:      '',
        path:        '',
        started:     '',
        due:         '',
        completed:   '',
        archived:    '',
        description: '',
        root:        '',
        rootSection: currentRoot,
        milestones:  [],
      };
      currentMs   = null;
      currentTask = null;
      inMilestone = false;
      continue;
    }

    if (!currentProject) continue;

    // H4: milestone heading
    const msMatch = line.match(milestoneRe);
    if (msMatch) {
      // Flush previous task and milestone
      if (currentTask && currentMs) currentMs.tasks.push(currentTask);
      if (currentMs) currentProject.milestones.push(currentMs);
      currentMs   = { id: msMatch[1], uuid: msMatch[3], name: msMatch[2].trim(), status: 'pending', tasks: [] };
      currentTask = null;
      inMilestone = true;
      continue;
    }

    // Subtask (two-space indent — must be checked before task)
    const stMatch = line.match(subtaskRe);
    if (stMatch && currentTask) {
      const doneMatch = (stMatch[5] || '').match(/done:(\S+)/);
      currentTask.subtasks.push({
        id:          stMatch[2],
        uuid:        stMatch[4],
        title:       stMatch[3].trim(),
        status:      checkCharToStatus(stMatch[1]),
        completedAt: doneMatch ? doneMatch[1] : null,
      });
      continue;
    }

    // Task line (within a milestone section)
    const tMatch = line.match(taskRe);
    if (tMatch && inMilestone) {
      if (currentTask) currentMs.tasks.push(currentTask);
      const doneMatch = (tMatch[5] || '').match(/done:(\S+)/);
      currentTask = {
        id:          tMatch[2],
        uuid:        tMatch[4],
        title:       tMatch[3].trim(),
        status:      checkCharToStatus(tMatch[1]),
        completedAt: doneMatch ? doneMatch[1] : null,
        subtasks:    [],
      };
      continue;
    }

    // Metadata list item (- key: value) for a project record
    if (!inMilestone && currentProject) {
      const metaMatch = line.match(metaRe);
      if (metaMatch) {
        const key = metaMatch[1];
        let   val = metaMatch[2].trim();
        // Strip surrounding quotes if present (JSON-style strings)
        if (val.startsWith('"') && val.endsWith('"')) {
          try { val = JSON.parse(val); } catch { /* leave as-is */ }
        }
        if (key in currentProject) currentProject[key] = val;
        continue;
      }
    }
  }

  // Flush the final project
  if (currentProject) {
    if (currentTask && currentMs) currentMs.tasks.push(currentTask);
    if (currentMs) currentProject.milestones.push(currentMs);
    projects.push(currentProject);
  }

  return projects;
}

/**
 * Map checkbox character to status string.
 * Duplicated from project-index-md.js to keep this module self-contained.
 */
function checkCharToStatus(ch) {
  if (ch === 'x') return 'completed';
  if (ch === '-') return 'cancelled';
  return 'pending';
}

/**
 * Map status string to checkbox character for rendering.
 */
function statusToCheckChar(status) {
  if (status === 'completed') return 'x';
  if (status === 'cancelled') return '-';
  return ' ';
}

// ---------------------------------------------------------------------------
// Render helpers: project entries in global index format
// ---------------------------------------------------------------------------

/**
 * Render a single project's milestone/task section for inclusion in the global index.
 * Omits the project statement blockquote (per spec).
 * Includes open blockers after the milestones block (resolved blockers excluded).
 *
 * For completed and archived projects, the milestone/task detail is replaced by
 * a single summary line:
 *   completed → `- [COMPLETED] {id} — done:{completed}`
 *   archived  → `- [ARCHIVED] {id} — archived:{archived}`
 *
 * Active (and other) projects render with full H4 milestone blocks as before.
 *
 * @param {Object} projectData - Parsed project-index-md data object.
 * @param {string} rootName - The root/vault name for H2 grouping.
 * @returns {string[]} Array of lines (no trailing newline on the block).
 */
function renderProjectEntry(projectData, rootName) {
  const lines = [];
  const fm    = projectData.frontmatter || {};

  // H3: project title
  lines.push(`### ${projectData.title || fm.title || fm.id || ''}`);
  lines.push('');

  // Metadata as a list
  lines.push(`- id: ${fm.id || ''}`);
  lines.push(`- status: ${fm.status || ''}`);
  lines.push(`- path: ${fm.path || ''}`);
  lines.push(`- started: ${fm.started || ''}`);
  lines.push(`- due: ${fm.due || ''}`);
  lines.push(`- completed: ${fm.completed || ''}`);
  lines.push(`- archived: ${fm.archived || ''}`);
  lines.push(`- description: ${JSON.stringify(fm.description || '')}`);
  lines.push(`- root: ${rootName}`);
  lines.push('');

  // Branch on status for completed/archived — render summary line only
  if (fm.status === 'completed') {
    lines.push(`- [COMPLETED] ${fm.id} — done:${fm.completed || ''}`);
    lines.push('');
    return lines;
  }

  if (fm.status === 'archived') {
    lines.push(`- [ARCHIVED] ${fm.id} — archived:${fm.archived || ''}`);
    lines.push('');
    return lines;
  }

  // Active (and other) projects: full milestone and task detail
  for (let mi = 0; mi < (projectData.milestones || []).length; mi++) {
    const ms    = projectData.milestones[mi];
    const msPos = `M-${mi + 1}`;
    lines.push(`#### ${msPos}: ${ms.name} (id:${ms.uuid})`);
    for (let ti = 0; ti < (ms.tasks || []).length; ti++) {
      const task    = ms.tasks[ti];
      const taskPos = `M${mi + 1}-T${ti + 1}`;
      const check   = statusToCheckChar(task.status);
      let taskLine  = `- [${check}] ${taskPos}: ${task.title} (id:${task.uuid})`;
      if (task.status === 'completed' && task.completedAt) taskLine += ` done:${task.completedAt}`;
      lines.push(taskLine);

      for (let si = 0; si < (task.subtasks || []).length; si++) {
        const sub    = task.subtasks[si];
        const subPos = `M${mi + 1}-T${ti + 1}-S${si + 1}`;
        const sCheck = statusToCheckChar(sub.status);
        let subLine  = `  - [${sCheck}] ${subPos}: ${sub.title} (id:${sub.uuid})`;
        if (sub.status === 'completed' && sub.completedAt) subLine += ` done:${sub.completedAt}`;
        lines.push(subLine);
      }
    }
    lines.push('');
  }

  // Open blockers (resolved blockers excluded entirely)
  const openBlockers = (projectData.blockers || []).filter(b => b.status !== 'resolved');
  if (openBlockers.length > 0) {
    for (let bi = 0; bi < openBlockers.length; bi++) {
      const b      = openBlockers[bi];
      const bPos   = `B-${bi + 1}`;
      let bLine    = `- [ ] [${bPos}] ${b.description} (id:${b.uuid}) waiting-on:"${b.waitingOn}" since:${b.since}`;
      if (b.affects && b.affects.length > 0) {
        bLine += ` affects:${b.affects.join(',')}`;
      }
      lines.push(bLine);
    }
    lines.push('');
  }

  return lines;
}

// ---------------------------------------------------------------------------
// appendProjectToGlobalIndex
//
// Called by `project create` immediately after writing the project directory.
// This keeps the global index from going stale between sweep runs.
//
// Strategy:
//   1. Locate current global index via globalIndexPath().
//   2. If the file does not exist, create it with a header and the new entry.
//   3. If the file exists, find the correct H2 section for the root and
//      append the new H3 project block. If no matching H2 section exists,
//      append a new one at the end.
// ---------------------------------------------------------------------------

/**
 * Append a project entry to the current global index file.
 * Creates the file (with today's date) if none exists.
 *
 * @param {string} workspace - Manager workspace path.
 * @param {Object} projectData - Parsed project data (from project-index-md.parse).
 * @param {string} rootName - The root name (for H2 section grouping).
 */
function appendProjectToGlobalIndex(workspace, projectData, rootName) {
  const indexFile = globalIndexPath(workspace);
  const projectsDir = path.dirname(indexFile);
  fs.mkdirSync(projectsDir, { recursive: true });

  const entryLines = renderProjectEntry(projectData, rootName);
  const entryBlock = entryLines.join('\n') + '\n';

  if (!fs.existsSync(indexFile)) {
    // First-run: create the file with a header and the first root section
    const today = formatDate(new Date(), '-');
    const header = [
      `# Global Project Index — ${today}`,
      '',
      `## ${rootName}`,
      '',
    ].join('\n');
    fs.writeFileSync(indexFile, header + entryBlock);
    log.info('global index created', { path: indexFile, root: rootName });
    return;
  }

  // File exists — append under the correct H2 section
  const existing = fs.readFileSync(indexFile, 'utf8').replace(/\r\n/g, '\n');
  const sectionHeader = `## ${rootName}`;
  const sectionIdx    = existing.indexOf('\n' + sectionHeader + '\n');

  if (sectionIdx !== -1) {
    // Section exists — find where it ends (next H2 or EOF)
    const afterSection = sectionIdx + sectionHeader.length + 2; // skip \n## Root\n
    const nextH2       = existing.indexOf('\n## ', afterSection);
    const insertAt     = nextH2 !== -1 ? nextH2 : existing.length;

    const before = existing.slice(0, insertAt);
    const after  = existing.slice(insertAt);
    // Ensure exactly one blank line before the new entry
    const separator = before.endsWith('\n\n') ? '' : '\n';
    fs.writeFileSync(indexFile, before + separator + entryBlock + after);
  } else {
    // Section does not exist — append new H2 and entry at the end
    const newSection = `\n## ${rootName}\n\n` + entryBlock;
    const trimmed    = existing.endsWith('\n') ? existing : existing + '\n';
    fs.writeFileSync(indexFile, trimmed + newSection);
  }

  log.info('project appended to global index', {
    path: indexFile,
    root: rootName,
    id:   (projectData.frontmatter || {}).id || '',
  });
}

// ---------------------------------------------------------------------------
// Rollback: remove a project entry from the global index.
// Called when project file creation fails after an append.
// ---------------------------------------------------------------------------

/**
 * Remove a project's H3 entry block from the global index by project ID.
 * Best-effort: logs a warning if the removal fails rather than throwing.
 *
 * @param {string} workspace - Manager workspace path.
 * @param {string} projectId - The project ID to remove.
 */
function rollbackProjectFromGlobalIndex(workspace, projectId) {
  const indexFile = globalIndexPath(workspace);
  if (!fs.existsSync(indexFile)) return;

  try {
    const content = fs.readFileSync(indexFile, 'utf8').replace(/\r\n/g, '\n');
    // Find the metadata line that identifies this project: `- id: {projectId}`
    const idLine  = `- id: ${projectId}`;
    const idIdx   = content.indexOf('\n' + idLine + '\n');
    if (idIdx === -1) return; // entry not found — nothing to remove

    // Walk back to find the H3 heading that starts this project block
    const h3Start = content.lastIndexOf('\n### ', idIdx);
    if (h3Start === -1) return;

    // Walk forward to find the next H3 or H2 heading (end of this project block)
    const afterH3  = h3Start + 1; // skip the \n before ###
    const nextH2   = content.indexOf('\n## ', afterH3);
    const nextH3   = content.indexOf('\n### ', afterH3);
    let   blockEnd;
    if (nextH2 !== -1 && (nextH3 === -1 || nextH2 < nextH3)) {
      blockEnd = nextH2;
    } else if (nextH3 !== -1) {
      blockEnd = nextH3;
    } else {
      blockEnd = content.length;
    }

    const updated = content.slice(0, h3Start) + content.slice(blockEnd);
    fs.writeFileSync(indexFile, updated);
    log.info('rolled back project from global index', { projectId, path: indexFile });
  } catch (err) {
    console.warn(`WARN: Global index rollback failed for '${projectId}': ${err.message}`);
    log.warn('global index rollback failed', { projectId, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Read global index: convenience wrapper around parse() + globalIndexPath()
// ---------------------------------------------------------------------------

/**
 * Read and parse the most recent global index file.
 * Returns an empty array if no global index file exists.
 *
 * @param {string} workspace - Manager workspace path.
 * @returns {Array<Object>} Flat array of project records.
 */
function readGlobalIndex(workspace) {
  const indexFile = globalIndexPath(workspace);
  if (!fs.existsSync(indexFile)) {
    log.debug('no global index found — returning empty', { workspace });
    return [];
  }
  const content = fs.readFileSync(indexFile, 'utf8');
  log.debug('global index read', { path: indexFile });
  return parse(content);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  parse,
  renderProjectEntry,
  appendProjectToGlobalIndex,
  rollbackProjectFromGlobalIndex,
  readGlobalIndex,
};
