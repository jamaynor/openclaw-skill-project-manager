// ---------------------------------------------------------------------------
// lib/project-index-md.js
//
// Parser, renderer, and mutation helpers for the unified project-index.md
// format. This module replaces the two-file README.md + tasks.md approach
// with a single file per project directory.
//
// File format overview:
//
//   ---
//   title: "Project Name"
//   id: yyyy.mm.dd-slug
//   project-uuid: p-{uuid}
//   status: active
//   tags:
//     - project
//   started: YYYY-MM-DD
//   due: YYYY-MM-DD
//   completed: ""
//   archived: ""
//   description: ""
//   path: /absolute/path/to/project/dir
//   last-touched: YYYY-MM-DD
//   ---
//
//   # Project Name
//
//   > Objective statement
//   > Lead: Name
//   > Due: YYYY-MM-DD
//
//   ## M-1: Milestone Name (id:m-{uuid})
//   - [ ] M1-T1: Task Name (id:t-{uuid})
//     > optional task description
//     - [ ] M1-T1-S1: Subtask Name (id:s-{uuid})
//   - [x] M1-T2: Done Task (id:t-{uuid}) done:YYYY-MM-DD
//
//   ## Blockers
//   - [ ] [B-1] Blocker desc (id:b-{uuid}) waiting-on:"Name" since:YYYY-MM-DD affects:[M-1] Name (id:m-{uuid})
//   - [x] [B-2] Resolved (id:b-{uuid}) waiting-on:"Name" since:YYYY-MM-DD resolved:YYYY-MM-DD
//
// WHY a single file: agents need the full project context (metadata +
// milestones + tasks) without coordinating across multiple files. A single
// file is also human-readable in Obsidian without any special tooling.
// ---------------------------------------------------------------------------

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import * as log from './logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_FILENAME = 'project-index.md';
const LOCK_SUFFIX    = '.lock';
const LOCK_STALE_MS  = 30000; // 30 seconds — matches tasks-md.js exactly
const FRONTMATTER_MARKER = '---';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return today's date as YYYY-MM-DD using local time (not UTC).
 * WHY local time: avoids the off-by-one issue where UTC midnight can
 * produce yesterday's date depending on the server's timezone offset.
 */
function todayStr() {
  const d  = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Resolve the absolute path of project-index.md inside a project directory.
 * @param {string} projPath - Absolute path to the project directory.
 * @returns {string}
 */
function indexFilePath(projPath) {
  return path.join(projPath, INDEX_FILENAME);
}

/**
 * Map checkbox characters to status strings.
 * ' ' → pending, 'x' → completed, '-' → cancelled
 */
function checkCharToStatus(ch) {
  if (ch === 'x') return 'completed';
  if (ch === '-') return 'cancelled';
  return 'pending';
}

/**
 * Map status strings back to checkbox characters for rendering.
 */
function statusToCheckChar(status) {
  if (status === 'completed') return 'x';
  if (status === 'cancelled') return '-';
  return ' ';
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (no YAML library — string manipulation only)
// WHY no YAML library: zero new dependencies is a hard requirement. The
// frontmatter schema is simple enough that line-by-line construction is
// readable and reliable.
// ---------------------------------------------------------------------------

/**
 * Build the YAML frontmatter block from a project data object.
 * Emits the new schema: title, id, project-uuid, status, tags, started, due,
 * completed, archived, description, path, last-touched.
 * project-uuid is positioned immediately after id and before status.
 *
 * @param {Object} fm - Frontmatter fields.
 * @returns {string} The complete frontmatter block including opening/closing ---.
 */
function buildFrontmatter(fm) {
  const lines = [
    FRONTMATTER_MARKER,
    `title: ${JSON.stringify(fm.title || '')}`,
    `id: ${fm.id || ''}`,
    `project-uuid: ${fm['project-uuid'] || ''}`,
    `status: ${fm.status || 'active'}`,
    'tags:',
    '  - project',
    `started: ${fm.started || ''}`,
    `due: ${fm.due || ''}`,
    `completed: ${fm.completed || ''}`,
    `archived: ${fm.archived || ''}`,
    `description: ${JSON.stringify(fm.description || '')}`,
    `path: ${fm.path || ''}`,
    `last-touched: ${fm['last-touched'] || todayStr()}`,
    FRONTMATTER_MARKER,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Extract the body (everything after the closing ---) from raw file content.
 * Returns the full content unchanged when no frontmatter is present.
 * Normalizes CRLF → LF.
 *
 * Reuses the same logic as lib/frontmatter.js so behaviour is consistent.
 *
 * @param {string} content - Raw file content.
 * @returns {string} Body text with LF line endings.
 */
function extractBody(content) {
  const c = content.replace(/\r\n/g, '\n');
  if (!c.startsWith(FRONTMATTER_MARKER + '\n')) return c;

  // Standard: closing --- followed by newline
  const endIdx = c.indexOf('\n' + FRONTMATTER_MARKER + '\n', FRONTMATTER_MARKER.length);
  if (endIdx !== -1) {
    return c.slice(endIdx + FRONTMATTER_MARKER.length + 2); // skip \n---\n
  }

  // Edge case: closing --- at end of file with no trailing newline
  if (c.endsWith('\n' + FRONTMATTER_MARKER)) {
    return '';
  }

  return c;
}

/**
 * Parse the YAML frontmatter block into a plain object.
 * Only handles the simple key: value pairs and the tags array that
 * our schema uses. No general-purpose YAML parsing.
 * The kvMatch regex matches hyphenated keys (e.g. project-uuid, last-touched).
 *
 * @param {string} content - Raw file content (CRLF already normalized).
 * @returns {Object} Parsed frontmatter fields.
 */
function parseFrontmatter(content) {
  const c = content.replace(/\r\n/g, '\n');
  const fm = {};

  if (!c.startsWith(FRONTMATTER_MARKER + '\n')) return fm;

  const endIdx = c.indexOf('\n' + FRONTMATTER_MARKER + '\n', FRONTMATTER_MARKER.length);
  const eofEnd = c.endsWith('\n' + FRONTMATTER_MARKER);

  const fmBlock = endIdx !== -1
    ? c.slice(FRONTMATTER_MARKER.length + 1, endIdx)
    : eofEnd
      ? c.slice(FRONTMATTER_MARKER.length + 1, c.length - FRONTMATTER_MARKER.length - 1)
      : '';

  const tags = [];
  let inTags = false;

  for (const line of fmBlock.split('\n')) {
    if (line === 'tags:') {
      inTags = true;
      fm.tags = tags;
      continue;
    }
    if (inTags) {
      const tagMatch = line.match(/^  - (.+)$/);
      if (tagMatch) {
        tags.push(tagMatch[1].trim());
        continue;
      }
      inTags = false;
    }

    // key: value pair — value may be JSON-quoted string or bare value
    // WHY [a-z0-9-]*: supports hyphenated keys like project-uuid and last-touched
    const kvMatch = line.match(/^([a-z][a-z0-9-]*): (.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const raw = kvMatch[2].trim();

    // Attempt to unwrap JSON string (e.g. title: "My Project")
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        fm[key] = JSON.parse(raw);
      } catch {
        fm[key] = raw;
      }
    } else {
      fm[key] = raw;
    }
  }

  if (!fm.tags) fm.tags = tags; // ensure tags is always an array
  return fm;
}

// ---------------------------------------------------------------------------
// Body parser state machine
// ---------------------------------------------------------------------------

/**
 * Parse the body section of a project-index.md into a structured object.
 *
 * The body follows this structure:
 *   # Project Name
 *   > objective
 *   > Lead: Name
 *   > Due: YYYY-MM-DD
 *   ## M-1: Milestone Name (id:m-{uuid})
 *   - [ ] M1-T1: Task Name (id:t-{uuid})
 *     > optional description
 *     - [ ] M1-T1-S1: Subtask Name (id:s-{uuid})
 *   ## Blockers
 *   - [ ] [B-1] Desc (id:b-{uuid}) waiting-on:"X" since:YYYY-MM-DD affects:[M-1] Name (id:m-...)
 *
 * Returns:
 *   {
 *     title: string,
 *     statement: { objective: string, lead: string, due: string },
 *     milestones: [{
 *       id: string,        // positional code, e.g. "M-1"
 *       uuid: string,      // stable uuid, e.g. "m-abc123"
 *       name: string,
 *       status: string,    // 'pending' | 'completed' | 'cancelled'
 *       tasks: [{
 *         id: string,      // positional code, e.g. "M1-T1"
 *         uuid: string,    // stable uuid, e.g. "t-abc123"
 *         title: string,
 *         description: string|null,
 *         status: string,
 *         completedAt: string|null,
 *         cancelledAt: string|null,
 *         subtasks: [{
 *           id: string,    // positional code, e.g. "M1-T1-S1"
 *           uuid: string,  // stable uuid, e.g. "s-abc123"
 *           title: string,
 *           status: string,
 *           completedAt: string|null,
 *         }]
 *       }]
 *     }],
 *     blockers: [{
 *       uuid: string,       // stable uuid, e.g. "b-abc123"
 *       description: string,
 *       waitingOn: string,
 *       since: string,
 *       affects: string[],  // array of display handle strings
 *       resolvedAt: string|null,
 *       status: 'open' | 'resolved',
 *     }]
 *   }
 *
 * @param {string} body - Body text (no frontmatter).
 * @returns {Object}
 */
function parseBody(body) {
  const lines = body.split('\n');
  const result = {
    title: '',
    statement: { objective: '', lead: '', due: '' },
    milestones: [],
    blockers: [],
  };

  let currentMilestone = null;
  let currentTask = null;
  let inBlockers = false;
  const statementLines = [];

  // Regex patterns — defined here so the parser loop is readable
  // WHY pre-compiled: avoids re-compiling on every line iteration.
  const titleRe       = /^# (.+)$/;
  const blockquoteRe  = /^> (.*)$/;
  // Milestone heading: ## M-1: Name (id:m-{uuid}) optionally with status suffix
  const milestoneRe   = /^## ([A-Z]-\d+): (.+?) \(id:(m-[0-9a-f-]+)\)(.*)$/;
  // Blockers section heading
  const blockersRe    = /^## Blockers$/;
  // Task: - [ ] M1-T1: Name (id:t-{uuid}) [done:YYYY-MM-DD] [cancelled:YYYY-MM-DD]
  const taskRe        = /^- \[([ x\-])\] ([A-Z0-9]+-T\d+): (.+?) \(id:(t-[0-9a-f-]+)\)(.*)?$/;
  // Subtask: two-space indent, then same pattern with s- prefix
  const subtaskRe     = /^  - \[([ x\-])\] ([A-Z0-9]+-T\d+-S\d+): (.+?) \(id:(s-[0-9a-f-]+)\)(.*)?$/;
  // Task description child line: two-space indent, blockquote prefix
  const descRe        = /^  > (.+)$/;
  // Blocker line: - [ ] [B-N] Desc (id:b-{uuid}) waiting-on:"..." since:YYYY-MM-DD ...
  const blockerLineRe = /^- \[([ x])\] \[B-\d+\] (.+?) \(id:(b-[0-9a-f-]+)\) waiting-on:"([^"]*)" since:(\S+)(.*)?$/;

  for (const line of lines) {
    // Title: first # heading
    if (!result.title) {
      const m = line.match(titleRe);
      if (m) {
        result.title = m[1].trim();
        continue;
      }
    }

    // Blockers section heading — must be checked before milestone regex
    if (line.match(blockersRe)) {
      // Flush current task and milestone
      if (currentTask && currentMilestone) {
        currentMilestone.tasks.push(currentTask);
        currentTask = null;
      }
      currentMilestone = null;
      inBlockers = true;
      continue;
    }

    // When inside the Blockers section, parse blocker lines
    if (inBlockers) {
      const bMatch = line.match(blockerLineRe);
      if (bMatch) {
        const checkChar   = bMatch[1];
        const description = bMatch[2].trim();
        const uuid        = bMatch[3];
        const waitingOn   = bMatch[4];
        const since       = bMatch[5];
        const trailing    = (bMatch[6] || '').trim();

        const status     = checkChar === 'x' ? 'resolved' : 'open';
        const resolvedMatch = trailing.match(/resolved:(\S+)/);
        const resolvedAt = resolvedMatch ? resolvedMatch[1] : null;

        // Parse affects field (only on open blockers)
        let affects = [];
        if (status === 'open') {
          const affectsMatch = trailing.match(/affects:(.+)$/);
          if (affectsMatch) {
            // Split on commas that precede '[' to handle names with commas
            affects = affectsMatch[1].split(/,(?=\[)/).map(s => s.trim());
          }
        }

        result.blockers.push({
          uuid,
          description,
          waitingOn,
          since,
          affects,
          resolvedAt,
          status,
        });
      }
      continue;
    }

    // Blockquote: project statement lines (only before milestones)
    if (!currentMilestone) {
      const bqMatch = line.match(blockquoteRe);
      if (bqMatch) {
        statementLines.push(bqMatch[1].trim());
        continue;
      }
    }

    // Milestone heading
    const msMatch = line.match(milestoneRe);
    if (msMatch) {
      // Save previous task into its milestone
      if (currentTask && currentMilestone) {
        currentMilestone.tasks.push(currentTask);
        currentTask = null;
      }
      currentMilestone = {
        id:     msMatch[1],   // e.g. "M-1"
        uuid:   msMatch[3],   // e.g. "m-abc123"
        name:   msMatch[2].trim(),
        status: 'pending',    // milestones themselves are logically pending until all tasks done
        tasks:  [],
      };
      result.milestones.push(currentMilestone);
      continue;
    }

    // Task description child line (must be checked before subtask since both use 2-space indent)
    // The '>' prefix disambiguates it from subtask lines ('  - [')
    const descMatch = line.match(descRe);
    if (descMatch && currentTask) {
      currentTask.description = descMatch[1].trim();
      continue;
    }

    // Subtask (must be checked before task since it has the two-space prefix)
    const stMatch = line.match(subtaskRe);
    if (stMatch && currentTask) {
      const checkChar   = stMatch[1];
      const doneMatch   = (stMatch[5] || '').match(/done:(\S+)/);
      currentTask.subtasks.push({
        id:          stMatch[2],   // e.g. "M1-T1-S1"
        uuid:        stMatch[4],   // e.g. "s-abc123"
        title:       stMatch[3].trim(),
        status:      checkCharToStatus(checkChar),
        completedAt: doneMatch ? doneMatch[1] : null,
      });
      continue;
    }

    // Task line
    const tMatch = line.match(taskRe);
    if (tMatch && currentMilestone) {
      // Save previous task
      if (currentTask) {
        currentMilestone.tasks.push(currentTask);
      }
      const checkChar     = tMatch[1];
      const doneMatch     = (tMatch[5] || '').match(/done:(\S+)/);
      const cancelledMatch = (tMatch[5] || '').match(/cancelled:(\S+)/);
      currentTask = {
        id:          tMatch[2],   // e.g. "M1-T1"
        uuid:        tMatch[4],   // e.g. "t-abc123"
        title:       tMatch[3].trim(),
        description: null,
        status:      checkCharToStatus(checkChar),
        completedAt: doneMatch ? doneMatch[1] : null,
        cancelledAt: cancelledMatch ? cancelledMatch[1] : null,
        subtasks:    [],
      };
      continue;
    }
  }

  // Flush last task
  if (currentTask && currentMilestone) {
    currentMilestone.tasks.push(currentTask);
  }

  // Parse statement blockquote lines into structured fields
  // Convention: first line is objective; "Lead: X" and "Due: X" are metadata
  for (const sl of statementLines) {
    if (sl.startsWith('Lead: ')) {
      result.statement.lead = sl.slice(6).trim();
    } else if (sl.startsWith('Due: ')) {
      result.statement.due = sl.slice(5).trim();
    } else {
      result.statement.objective = result.statement.objective
        ? result.statement.objective + ' ' + sl
        : sl;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API: parse and render
// ---------------------------------------------------------------------------

/**
 * Parse the full content of a project-index.md file into a structured object.
 *
 * Returns:
 *   {
 *     frontmatter: Object,   // all YAML fields as a plain object
 *     title: string,
 *     statement: { objective, lead, due },
 *     milestones: [...],     // see parseBody for shape
 *     blockers: [...],       // see parseBody for shape
 *   }
 *
 * @param {string} content - Raw file content.
 * @returns {Object}
 */
function parse(content) {
  const fm   = parseFrontmatter(content);
  const body = extractBody(content);
  const parsed = parseBody(body);

  return {
    frontmatter: fm,
    title:       parsed.title,
    statement:   parsed.statement,
    milestones:  parsed.milestones,
    blockers:    parsed.blockers,
  };
}

/**
 * Render a parsed project data structure back into a project-index.md string.
 * Recalculates all positional codes (M-1, M1-T1, M1-T1-S1, B-1) from position.
 * UUIDs are preserved unchanged.
 *
 * @param {Object} data - Structured project data as returned by parse().
 * @returns {string} Complete file content.
 */
function render(data) {
  const fm = data.frontmatter || {};
  const lines = [];

  // Frontmatter block
  lines.push(buildFrontmatter(fm).trimEnd());
  lines.push('');

  // Title heading
  const title = data.title || fm.title || '';
  lines.push(`# ${title}`);
  lines.push('');

  // Project statement blockquote
  const stmt = data.statement || {};
  if (stmt.objective) lines.push(`> ${stmt.objective}`);
  if (stmt.lead)      lines.push(`> Lead: ${stmt.lead}`);
  if (stmt.due)       lines.push(`> Due: ${stmt.due}`);
  if (stmt.objective || stmt.lead || stmt.due) lines.push('');

  // Milestones with recalculated positional codes
  const milestones = data.milestones || [];
  for (let mi = 0; mi < milestones.length; mi++) {
    const ms    = milestones[mi];
    const msPos = `M-${mi + 1}`;            // positional: M-1, M-2, ...

    lines.push(`## ${msPos}: ${ms.name} (id:${ms.uuid})`);

    const tasks = ms.tasks || [];
    for (let ti = 0; ti < tasks.length; ti++) {
      const task    = tasks[ti];
      const taskPos = `M${mi + 1}-T${ti + 1}`;  // positional: M1-T1, M1-T2, ...
      const check   = statusToCheckChar(task.status);
      let taskLine  = `- [${check}] ${taskPos}: ${task.title} (id:${task.uuid})`;
      if (task.status === 'completed' && task.completedAt) {
        taskLine += ` done:${task.completedAt}`;
      }
      if (task.status === 'cancelled' && task.cancelledAt) {
        taskLine += ` cancelled:${task.cancelledAt}`;
      }
      lines.push(taskLine);

      // Description child line (immediately after task line, before subtasks)
      if (task.description) {
        lines.push(`  > ${task.description}`);
      }

      const subtasks = task.subtasks || [];
      for (let si = 0; si < subtasks.length; si++) {
        const sub    = subtasks[si];
        const subPos = `M${mi + 1}-T${ti + 1}-S${si + 1}`;  // positional: M1-T1-S1, ...
        const sCheck = statusToCheckChar(sub.status);
        let subLine  = `  - [${sCheck}] ${subPos}: ${sub.title} (id:${sub.uuid})`;
        if (sub.status === 'completed' && sub.completedAt) {
          subLine += ` done:${sub.completedAt}`;
        }
        lines.push(subLine);
      }
    }

    // Blank line after each milestone for readability
    lines.push('');
  }

  // Blockers section (after all milestone blocks)
  const blockers = data.blockers || [];
  if (blockers.length > 0) {
    lines.push('## Blockers');
    lines.push('');
    for (let bi = 0; bi < blockers.length; bi++) {
      const b       = blockers[bi];
      const bPos    = `B-${bi + 1}`;
      const check   = b.status === 'resolved' ? 'x' : ' ';
      let blockerLine = `- [${check}] [${bPos}] ${b.description} (id:${b.uuid}) waiting-on:"${b.waitingOn}" since:${b.since}`;
      if (b.status === 'resolved' && b.resolvedAt) {
        blockerLine += ` resolved:${b.resolvedAt}`;
      } else if (b.status !== 'resolved' && b.affects && b.affects.length > 0) {
        blockerLine += ` affects:${b.affects.join(',')}`;
      }
      lines.push(blockerLine);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API: read and write
// ---------------------------------------------------------------------------

/**
 * Read project-index.md from a project directory and parse it.
 *
 * @param {string} projPath - Absolute path to the project directory.
 * @returns {Object} Parsed project data.
 * @throws {Error} If the file does not exist.
 */
function read(projPath) {
  const filePath = indexFilePath(projPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`ERROR: No project-index.md found at ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  log.debug('project-index.md read', { path: filePath });
  return parse(content);
}

/**
 * Write a project data structure to project-index.md.
 * Always updates the `last-touched` frontmatter field to today's date.
 *
 * @param {string} projPath - Absolute path to the project directory.
 * @param {Object} data - Project data as returned by parse().
 */
function write(projPath, data) {
  // Update last-touched before writing so callers don't have to remember
  data.frontmatter['last-touched'] = todayStr();

  const filePath = indexFilePath(projPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, render(data));
  log.debug('project-index.md written', { path: filePath });
}

// ---------------------------------------------------------------------------
// Lockfile helper (shared by addMilestone and addTask)
// Replicates the tasks-md.js lockfile pattern exactly:
//   - wx-mode exclusive create (atomic on POSIX)
//   - 30-second stale detection
//   - finally-block cleanup
// ---------------------------------------------------------------------------

/**
 * Acquire a lockfile for exclusive write access to project-index.md.
 * Returns the file descriptor for the lock. Caller MUST release via
 * releaseLock() in a finally block.
 *
 * @param {string} lockFile - Absolute path to the lock file.
 * @returns {number} File descriptor.
 * @throws {Error} If locked by another process (and not stale).
 */
function acquireLock(lockFile) {
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') {
      let stale = false;
      try {
        const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
        stale = ageMs > LOCK_STALE_MS;
      } catch { /* lockfile removed between EEXIST and stat */ }

      if (stale) {
        console.warn('WARN: Stale lock detected (> 30s old) — removing and retrying');
        log.warn('stale lock detected', { path: lockFile });
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
        lockFd = fs.openSync(lockFile, 'wx');
      } else {
        throw new Error('ERROR: project-index.md is locked by another process. Try again in a moment.');
      }
    } else {
      throw e;
    }
  }
  return lockFd;
}

/**
 * Release a lockfile acquired by acquireLock().
 * @param {number} lockFd - File descriptor returned by acquireLock().
 * @param {string} lockFile - Absolute path to the lock file.
 */
function releaseLock(lockFd, lockFile) {
  fs.closeSync(lockFd);
  try { fs.unlinkSync(lockFile); } catch { /* ignore — already cleaned up */ }
}

// ---------------------------------------------------------------------------
// Public API: addMilestone
// ---------------------------------------------------------------------------

/**
 * Add a new milestone to a project's project-index.md with lockfile protection.
 * Replicates the lockfile pattern from tasks-md.js addTask exactly.
 *
 * @param {string} projPath - Absolute path to the project directory.
 * @param {Object} opts - Milestone options.
 * @param {string} opts.name - Milestone name.
 * @param {string} [opts.due] - Optional due date (YYYY-MM-DD).
 * @returns {Object} The newly created milestone object.
 */
function addMilestone(projPath, opts) {
  const filePath = indexFilePath(projPath);
  const lockFile = filePath + LOCK_SUFFIX;

  const lockFd = acquireLock(lockFile);
  try {
    const data = read(projPath);

    const newUuid      = `m-${crypto.randomUUID()}`;
    const newMilestone = {
      id:     `M-${data.milestones.length + 1}`, // placeholder; render recalculates
      uuid:   newUuid,
      name:   opts.name,
      status: 'pending',
      tasks:  [],
    };

    data.milestones.push(newMilestone);
    write(projPath, data);

    log.info('milestone added', { projPath, name: opts.name, uuid: newUuid });
    return newMilestone;
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// Public API: addTask
// ---------------------------------------------------------------------------

/**
 * Add a new task to a specific milestone in project-index.md with lockfile
 * protection.
 *
 * The milestone is identified by either:
 *   - A UUID string prefixed with 'm-', e.g. 'm-abc123-...'
 *   - A positional code, e.g. 'M-1' or 'M-2'
 *
 * @param {string} projPath - Absolute path to the project directory.
 * @param {string} milestoneId - Milestone UUID or positional code.
 * @param {Object} opts - Task options.
 * @param {string} opts.title - Task title.
 * @param {string} [opts.description] - Optional task description (stored as child line).
 * @param {string[]} [opts.successCriteria] - Success criteria (stored as subtasks).
 * @returns {Object} The newly created task object.
 */
function addTask(projPath, milestoneId, opts) {
  const filePath = indexFilePath(projPath);
  const lockFile = filePath + LOCK_SUFFIX;

  const lockFd = acquireLock(lockFile);
  try {
    const data = read(projPath);

    // Locate the target milestone by UUID or positional code
    // WHY support both: UUIDs are stable identifiers for machine use;
    // positional codes like 'M-1' are human-friendly for CLI use.
    const ms = data.milestones.find(m =>
      m.uuid === milestoneId || m.id === milestoneId
    );

    if (!ms) {
      throw new Error(`ERROR: Milestone '${milestoneId}' not found in project at ${projPath}`);
    }

    const newUuid = `t-${crypto.randomUUID()}`;
    const newTask = {
      id:          `M?-T${ms.tasks.length + 1}`, // placeholder; render recalculates
      uuid:        newUuid,
      title:       opts.title,
      description: opts.description || null,
      status:      'pending',
      completedAt: null,
      cancelledAt: null,
      subtasks:    [],
    };

    ms.tasks.push(newTask);
    write(projPath, data);

    log.info('task added', { projPath, milestoneId, title: opts.title, uuid: newUuid });
    return newTask;
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  parse,
  render,
  read,
  write,
  addMilestone,
  addTask,
  // Exported for testing and reuse
  buildFrontmatter,
  extractBody,
  parseFrontmatter,
  indexFilePath,
  todayStr,
  acquireLock,
  releaseLock,
};
