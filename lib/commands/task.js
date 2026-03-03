'use strict';

const { loadIndex, parseArgs } = require('../config');
const tasksMd = require('../tasks-md');
const log = require('../logger');

function add(workspace, args) {
  const opts = parseArgs(args);
  if (!opts.id)             { throw new Error('ERROR: --id is required');          }
  if (!opts.title)          { throw new Error('ERROR: --title is required');        }
  if (!opts.description)    { throw new Error('ERROR: --description is required');  }
  if (!opts['worker-type']) { throw new Error('ERROR: --worker-type is required');  }

  const index = loadIndex(workspace);
  const proj  = index.projects.find(p => p.id === opts.id);
  if (!proj) { throw new Error(`ERROR: Project '${opts.id}' not found`); }

  // Build successCriteria array from --criteria (repeatable flag); drop blanks
  const criteria = opts.criteria
    ? (Array.isArray(opts.criteria) ? opts.criteria : [opts.criteria]).filter(s => s.trim())
    : [];

  const newTask = tasksMd.addTask(proj.path, {
    title:           opts.title,
    description:     opts.description,
    successCriteria: criteria,
    workerType:      opts['worker-type'],
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      projectId: opts.id,
      ...newTask,
    }) + '\n');
    return;
  }

  log.info('task added', { projectId: opts.id, taskId: newTask.id, title: opts.title });
  console.log(`\u2705 Task ${newTask.id} added to ${opts.id}`);
  console.log(`   Title: ${opts.title}`);
  if (criteria.length > 0) console.log(`   Criteria: ${criteria.length} item(s)`);
}

module.exports = { add };
