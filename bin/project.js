#!/usr/bin/env node

import { Command } from 'commander';
import { resolveWorkspace, resolveAgentWorkspace } from '../lib/config.js';
import * as log       from '../lib/logger.js';
import * as create    from '../lib/commands/create.js';
import * as list      from '../lib/commands/list.js';
import * as statusCmd from '../lib/commands/status.js';
import * as show      from '../lib/commands/show.js';
import * as tasksCmd  from '../lib/commands/tasks.js';
import * as taskCmd   from '../lib/commands/task.js';
import * as milestone from '../lib/commands/milestone.js';
import * as blockerCmd from '../lib/commands/blocker.js';

let workspace;
let agentWorkspace;

const program = new Command();

program
  .name('project')
  .description('OpenClaw Project Commands')
  .option('--workspace <path>', 'Override agent workspace (also: HAL_PROG_MGR_MASTER_WORKSPACE)')
  .option('--agent-workspace <path>', 'Override creating agent workspace (also: HAL_AGENT_WORKSPACE)');

program.hook('preAction', (thisCommand, actionCommand) => {
  const g = program.opts();
  workspace      = resolveWorkspace(g.workspace);
  agentWorkspace = resolveAgentWorkspace(g.agentWorkspace, g.workspace);
  log.init({ command: actionCommand.name(), workspace });
});

program.hook('postAction', () => {
  log.close();
});

// project create
program
  .command('create')
  .description('Create a new project')
  .requiredOption('--name <name>', 'Project name')
  .requiredOption('--root <root>', 'Root name')
  .requiredOption('--due <date>', 'Due date (YYYY-MM-DD)')
  .requiredOption('--goals <goals>', 'Project goals')
  .option('--description <desc>', 'Brief description')
  .option('--date <date>', 'Creation date override (YYYY-MM-DD)')
  .option('--json', 'Emit JSON output')
  .action((opts) => {
    create.run(workspace, agentWorkspace, opts);
  });

// project list
program
  .command('list')
  .description('List projects')
  .option('--root <root>', 'Filter by root name')
  .option('--status <status>', 'Filter by status (active|completed|archived)')
  .option('--json', 'Emit JSON output')
  .action((opts) => {
    list.run(workspace, agentWorkspace, opts);
  });

// project show
program
  .command('show')
  .description('Show project details')
  .requiredOption('--id <id>', 'Project ID')
  .option('--json', 'Emit JSON output')
  .action((opts) => {
    show.run(workspace, agentWorkspace, opts);
  });

// project tasks
program
  .command('tasks')
  .description('List tasks for a project')
  .requiredOption('--id <id>', 'Project ID')
  .option('--json', 'Emit JSON output')
  .action((opts) => {
    tasksCmd.run(workspace, agentWorkspace, opts);
  });

// project task add / complete / update / cancel (nested)
const taskCmd2 = program.command('task').description('Task operations');
taskCmd2
  .command('add')
  .description('Add a task to a project milestone')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--milestone <ref>', 'Milestone UUID or positional code (e.g. M-1)')
  .requiredOption('--title <title>', 'Task title')
  .option('--description <desc>', 'Task description')
  .option('--json', 'Emit JSON output')
  .action((opts) => {
    taskCmd.add(workspace, opts);
  });

taskCmd2
  .command('complete')
  .description('Mark a task as complete by UUID')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--task <uuid>', 'Task UUID (t-{uuid})')
  .action((opts) => {
    taskCmd.complete(workspace, opts);
  });

taskCmd2
  .command('update')
  .description('Update a task title and/or description by UUID')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--task <uuid>', 'Task UUID (t-{uuid})')
  .option('--title <title>', 'New task title')
  .option('--description <desc>', 'New task description')
  .action((opts) => {
    taskCmd.update(workspace, opts);
  });

taskCmd2
  .command('cancel')
  .description('Cancel a task by UUID')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--task <uuid>', 'Task UUID (t-{uuid})')
  .option('--reason <text>', 'Cancellation reason (stored as description)')
  .action((opts) => {
    taskCmd.cancel(workspace, opts);
  });

// project milestone add / complete (nested)
const milestoneCmd = program.command('milestone').description('Milestone operations');
milestoneCmd
  .command('add')
  .description('Add a milestone to a project')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--name <name>', 'Milestone name')
  .requiredOption('--due <date>', 'Due date (YYYY-MM-DD)')
  .action((opts) => {
    milestone.add(workspace, opts);
  });

milestoneCmd
  .command('complete')
  .description('Mark a milestone as complete')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--name <name>', 'Milestone name')
  .action((opts) => {
    milestone.complete(workspace, opts);
  });

// project blocker add / resolve (nested)
const blockerCmdGroup = program.command('blocker').description('Blocker operations');
blockerCmdGroup
  .command('add')
  .description('Add a blocker to a project')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--description <text>', 'Blocker description')
  .requiredOption('--waiting-on <name>', 'Who or what is being waited on')
  .requiredOption('--affects <refs>', 'Comma-separated list of milestone or task UUIDs')
  .action((opts) => {
    blockerCmd.add(workspace, opts);
  });

blockerCmdGroup
  .command('resolve')
  .description('Resolve a blocker by UUID')
  .requiredOption('--id <id>', 'Project ID')
  .requiredOption('--blocker <uuid>', 'Blocker UUID (b-{uuid})')
  .action((opts) => {
    blockerCmd.resolve(workspace, opts);
  });

// project complete
program
  .command('complete')
  .description('Mark a project as complete')
  .requiredOption('--id <id>', 'Project ID')
  .action((opts) => {
    statusCmd.run(workspace, agentWorkspace, opts, 'completed');
  });

// project archive
program
  .command('archive')
  .description('Archive a project')
  .requiredOption('--id <id>', 'Project ID')
  .action((opts) => {
    statusCmd.run(workspace, agentWorkspace, opts, 'archived');
  });

program.parseAsync(process.argv).catch(err => {
  log.error('command failed', { error: err.message });
  log.close();
  console.error(err.message);
  process.exit(1);
});
