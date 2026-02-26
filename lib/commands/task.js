'use strict';

const fs   = require('fs');
const path = require('path');
const { loadIndex, parseArgs } = require('../config');

function add(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id)             { throw new Error('ERROR: --id is required');          }
  if (!opts.title)          { throw new Error('ERROR: --title is required');        }
  if (!opts.description)    { throw new Error('ERROR: --description is required');  }
  if (!opts['worker-type']) { throw new Error('ERROR: --worker-type is required');  }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const tasksFile = path.join(proj.path, 'tasks.json');
  if (!fs.existsSync(tasksFile)) {
    throw new Error(`ERROR: tasks.json not found at ${tasksFile}`);
  }

  // Acquire an exclusive lockfile to prevent concurrent writes.
  // If the lock is stale (> 30 s old, e.g. from a crashed process), remove and retry.
  const lockFile = tasksFile + '.lock';
  let lockFd;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') {
      let stale = false;
      try {
        const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
        stale = ageMs > 30000;
      } catch { /* lockfile removed between EEXIST and stat — proceed */ }
      if (stale) {
        console.error('WARN: Stale lock detected (> 30s old) — removing and retrying');
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
        lockFd = fs.openSync(lockFile, 'wx');
      } else {
        throw new Error('ERROR: tasks.json is locked by another process. Try again in a moment.');
      }
    } else {
      throw e;
    }
  }

  try {
    let tasksData;
    try {
      tasksData = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    } catch (e) {
      throw new Error(`ERROR: tasks.json is not valid JSON: ${e.message}`);
    }

    // Auto-increment task ID based on highest existing task-N number
    const tasks = tasksData.tasks || [];
    let maxN = 0;
    for (const t of tasks) {
      const m = /^task-(\d+)$/.exec(t.id || '');
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const newId = `task-${maxN + 1}`;

    // Build successCriteria array from --criteria (repeatable flag); drop blanks
    const criteria = opts.criteria
      ? (Array.isArray(opts.criteria) ? opts.criteria : [opts.criteria]).filter(s => s.trim())
      : [];

    const newTask = {
      id:              newId,
      title:           opts.title,
      description:     opts.description,
      successCriteria: criteria,
      workerType:      opts['worker-type'],
      status:          'pending',
      output:          '',
      learnings:       '',
      completedAt:     null,
    };

    tasks.push(newTask);
    tasksData.tasks = tasks;

    fs.writeFileSync(tasksFile, JSON.stringify(tasksData, null, 2) + '\n');
  } finally {
    fs.closeSync(lockFd);
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }

  console.log(`✅ Task ${newId} added to ${opts.id}`);
  console.log(`   Title: ${opts.title}`);
  if (criteria.length > 0) console.log(`   Criteria: ${criteria.length} item(s)`);
}

module.exports = { add };
