import fs   from 'fs';
import path from 'path';
import * as log from './logger.js';

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

function tasksFilePath(projPath) {
  return path.join(projPath, 'tasks.md');
}

// ---------------------------------------------------------------------------
// Render: tasksData → markdown string
// ---------------------------------------------------------------------------

function render(data) {
  const lines = [];

  lines.push(`# ${data.title}`);
  lines.push('');

  if (data.description) {
    lines.push(`> ${data.description}`);
    lines.push('');
  }

  lines.push('## Tasks');
  lines.push('');

  for (const t of (data.tasks || [])) {
    // Checkbox
    let check;
    if (t.status === 'cancelled') check = '[-]';
    else if (t.status === 'completed') check = '[x]';
    else check = '[ ]';

    // Inline metadata
    let meta = `\`${t.id}\``;
    if (t.workerType) meta += ` \`${t.workerType}\``;
    if (t.status === 'in-progress') meta += ' in-progress';
    if (t.status === 'completed' && t.completedAt) meta += ` done:${t.completedAt.slice(0, 10)}`;
    if (t.status === 'cancelled') meta += ' cancelled';

    lines.push(`- ${check} ${t.title} ${meta}`);

    // Description
    if (t.description) {
      lines.push(`  ${t.description}`);
    }

    // Output
    if (t.output) {
      lines.push(`  output: ${t.output}`);
    }

    // Learnings
    if (t.learnings) {
      lines.push(`  learnings: ${t.learnings}`);
    }

    // Success criteria
    const criteria = t.successCriteria || [];
    for (const c of criteria) {
      const cCheck = t.status === 'completed' ? '[x]' : '[ ]';
      lines.push(`  - ${cCheck} ${c}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parse: markdown string → tasksData
// ---------------------------------------------------------------------------

function parse(content) {
  const lines = content.split('\n');
  const data = { title: '', description: '', tasks: [] };

  let inTasks = false;
  let currentTask = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Title: # heading on first non-empty line
    if (!data.title) {
      const titleMatch = line.match(/^# (.+)$/);
      if (titleMatch) {
        data.title = titleMatch[1].trim();
        continue;
      }
    }

    // Description: blockquote
    if (!inTasks) {
      const bqMatch = line.match(/^> (.+)$/);
      if (bqMatch) {
        data.description = data.description
          ? data.description + ' ' + bqMatch[1].trim()
          : bqMatch[1].trim();
        continue;
      }
    }

    // Tasks heading
    if (/^## Tasks\s*$/.test(line)) {
      inTasks = true;
      continue;
    }

    if (!inTasks) continue;

    // Top-level task line: - [ ] / - [x] / - [-]
    const taskMatch = line.match(/^- \[([ x\-])\] (.+)$/);
    if (taskMatch) {
      // Save previous task
      if (currentTask) data.tasks.push(currentTask);

      const checkChar = taskMatch[1];
      const rest = taskMatch[2];

      // Parse inline metadata from the rest of the line
      // Title is everything before the first backtick segment
      const backtickPattern = /`([^`]+)`/g;
      const backticks = [];
      let m;
      while ((m = backtickPattern.exec(rest)) !== null) {
        backticks.push({ value: m[1], index: m.index });
      }

      let title = rest;
      let id = '';
      let workerType = '';
      let statusKeyword = '';

      if (backticks.length > 0) {
        title = rest.slice(0, backticks[0].index).trim();
        id = backticks[0].value;
        if (backticks.length > 1) workerType = backticks[1].value;

        // Everything after the last backtick segment
        const lastBt = backticks[backticks.length - 1];
        const afterBackticks = rest.slice(lastBt.index + lastBt.value.length + 2).trim();
        statusKeyword = afterBackticks;
      }

      // Determine status
      let status;
      let completedAt = null;
      if (checkChar === '-') {
        status = 'cancelled';
      } else if (checkChar === 'x') {
        status = 'completed';
        const doneMatch = statusKeyword.match(/done:(\S+)/);
        if (doneMatch) completedAt = doneMatch[1];
      } else if (statusKeyword.includes('in-progress')) {
        status = 'in-progress';
      } else {
        status = 'pending';
      }

      currentTask = {
        id,
        title,
        description: '',
        successCriteria: [],
        workerType,
        status,
        output: '',
        learnings: '',
        completedAt,
      };
      continue;
    }

    // Indented lines belong to current task
    if (currentTask && /^ {2}/.test(line)) {
      const trimmed = line.slice(2);

      // Subtask (success criteria)
      const subMatch = trimmed.match(/^- \[([ x])\] (.+)$/);
      if (subMatch) {
        currentTask.successCriteria.push(subMatch[2]);
        continue;
      }

      // Output line
      const outputMatch = trimmed.match(/^output: (.+)$/);
      if (outputMatch) {
        currentTask.output = outputMatch[1];
        continue;
      }

      // Learnings line
      const learningsMatch = trimmed.match(/^learnings: (.+)$/);
      if (learningsMatch) {
        currentTask.learnings = learningsMatch[1];
        continue;
      }

      // Description line (plain text)
      if (trimmed) {
        currentTask.description = currentTask.description
          ? currentTask.description + ' ' + trimmed
          : trimmed;
      }
    }
  }

  // Push last task
  if (currentTask) data.tasks.push(currentTask);

  return data;
}

// ---------------------------------------------------------------------------
// Read: projPath → tasksData (with auto-migration from tasks.json)
// ---------------------------------------------------------------------------

function read(projPath) {
  const mdPath   = tasksFilePath(projPath);
  const jsonPath = path.join(projPath, 'tasks.json');

  if (fs.existsSync(mdPath)) {
    log.debug('tasks file read', { path: mdPath });
    return parse(fs.readFileSync(mdPath, 'utf8'));
  }

  if (fs.existsSync(jsonPath)) {
    // Auto-migrate
    const raw = fs.readFileSync(jsonPath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      log.error('tasks.json parse failure', { path: jsonPath, error: e.message });
      throw new Error(`ERROR: tasks.json is not valid JSON: ${e.message}`);
    }
    write(projPath, data);
    fs.unlinkSync(jsonPath);
    log.info('migrated tasks.json to tasks.md', { path: projPath });
    return data;
  }

  throw new Error(`ERROR: No task file found at ${projPath}`);
}

// ---------------------------------------------------------------------------
// Write: projPath + tasksData → void
// ---------------------------------------------------------------------------

function write(projPath, data) {
  const mdPath = tasksFilePath(projPath);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, render(data));
  log.debug('tasks file written', { path: mdPath });
}

// ---------------------------------------------------------------------------
// addTask: projPath + newTaskOpts → task (with lockfile)
// ---------------------------------------------------------------------------

function addTask(projPath, opts) {
  const mdPath   = tasksFilePath(projPath);
  const lockFile = mdPath + '.lock';

  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') {
      let stale = false;
      try {
        const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
        stale = ageMs > 30000;
      } catch { /* lockfile removed between EEXIST and stat */ }
      if (stale) {
        console.warn('WARN: Stale lock detected (> 30s old) — removing and retrying');
        log.warn('stale lock detected', { path: lockFile });
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
        lockFd = fs.openSync(lockFile, 'wx');
      } else {
        throw new Error('ERROR: tasks.md is locked by another process. Try again in a moment.');
      }
    } else {
      throw e;
    }
  }

  try {
    const data = read(projPath);

    // Auto-increment task ID
    let maxN = 0;
    for (const t of data.tasks) {
      const m = /^task-(\d+)$/.exec(t.id || '');
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const newId = `task-${maxN + 1}`;

    const newTask = {
      id:              newId,
      title:           opts.title,
      description:     opts.description,
      successCriteria: opts.successCriteria || [],
      workerType:      opts.workerType,
      status:          'pending',
      output:          '',
      learnings:       '',
      completedAt:     null,
    };

    data.tasks.push(newTask);
    write(projPath, data);

    return newTask;
  } finally {
    fs.closeSync(lockFd);
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }
}

export { render, parse, tasksFilePath, read, write, addTask };
