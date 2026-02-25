'use strict';

const fs   = require('fs');
const path = require('path');
const { loadIndex, parseArgs } = require('../config');

const STATUS_ORDER = ['in-progress', 'pending', 'completed', 'cancelled'];

function run(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id) { throw new Error('ERROR: --id is required'); }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  const tasksFile = path.join(proj.path, 'tasks.json');
  if (!fs.existsSync(tasksFile)) {
    throw new Error(`ERROR: tasks.json not found at ${tasksFile}`);
  }

  let raw;
  try {
    raw = fs.readFileSync(tasksFile, 'utf8');
  } catch (e) {
    throw new Error(`ERROR: Could not read tasks.json: ${e.message}`);
  }

  let tasksData;
  try {
    tasksData = JSON.parse(raw);
  } catch (e) {
    throw new Error(`ERROR: tasks.json is not valid JSON: ${e.message}`);
  }

  if (opts.json) {
    // Pass file content through unchanged; ensure trailing newline
    console.log(raw.trimEnd());
    return;
  }

  // Human-readable output
  console.log('');
  console.log(`Project: ${tasksData.title}`);
  if (tasksData.description) console.log(`Goals:   ${tasksData.description}`);
  console.log('');

  const tasks = tasksData.tasks || [];
  if (tasks.length === 0) {
    console.log('No tasks.');
    return;
  }

  // Group by status
  const groups = {};
  for (const t of tasks) {
    const s = t.status || 'unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(t);
  }

  const seen = new Set();
  for (const s of STATUS_ORDER) {
    if (!groups[s]) continue;
    seen.add(s);
    console.log(`${s.toUpperCase()} (${groups[s].length})`);
    for (const t of groups[s]) {
      console.log(`  [${t.id}] ${t.title}`);
      if (t.description) console.log(`        ${t.description}`);
      if (t.workerType)  console.log(`        worker: ${t.workerType}`);
    }
    console.log('');
  }

  // Any unrecognized statuses
  for (const [s, list] of Object.entries(groups)) {
    if (seen.has(s)) continue;
    console.log(`${s.toUpperCase()} (${list.length})`);
    for (const t of list) console.log(`  [${t.id}] ${t.title}`);
    console.log('');
  }
}

module.exports = { run };
