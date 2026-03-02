#!/usr/bin/env node
'use strict';

const { resolveWorkspace, resolveAgentWorkspace } = require('../lib/config');
const create    = require('../lib/commands/create');
const list      = require('../lib/commands/list');
const status    = require('../lib/commands/status');
const show      = require('../lib/commands/show');
const tasksCmd  = require('../lib/commands/tasks');
const taskCmd   = require('../lib/commands/task');
const milestone = require('../lib/commands/milestone');

const [,, cmd, ...args] = process.argv;

const USAGE = `
project — OpenClaw Project Commands

Usage:
  project create --name <name> --root <root> --due YYYY-MM-DD --goals "..."
                 [--description <desc>] [--date YYYY-MM-DD] [--workspace <path>]
  project list   [--root <root>] [--status active|completed|archived] [--json]
  project show   --id <project-id>
  project tasks  --id <project-id> [--json]
  project task   add --id <project-id> --title "..." --description "..."
                     --worker-type <type> [--criteria "..."] [--criteria "..."]
  project milestone add      --id <project-id> --name <name> --due YYYY-MM-DD
  project milestone complete --id <project-id> --name <name>
  project complete --id <project-id>
  project archive  --id <project-id>
  project help

Global options:
  --workspace <path>   Override agent workspace path
                       (also: HAL_PROG_MGR_MASTER_WORKSPACE env var)
  --agent-workspace <path>
                       Override creating agent workspace for {agent-workspace}
                       expansion (also: HAL_AGENT_WORKSPACE env var)

Examples:
  project create --name "Sales Pipeline" --root lmb-vault --due 2026-06-30 \\
    --goals "Automate lead tracking from all sources into a single pipeline"
  project list
  project list --status active --root lmb-vault
  project list --json
  project show  --id 2026.02.24-lmb-sales-pipeline
  project tasks --id 2026.02.24-lmb-sales-pipeline
  project tasks --id 2026.02.24-lmb-sales-pipeline --json
  project task add --id 2026.02.24-lmb-sales-pipeline --title "Map sources" \\
    --description "Identify all lead entry points" --worker-type node \\
    --criteria "All sources listed" --criteria "Owner identified"
  project milestone add      --id 2026.02.24-lmb-sales-pipeline --name "MVP" --due 2026-04-01
  project milestone complete  --id 2026.02.24-lmb-sales-pipeline --name "MVP"
  project complete --id 2026.02.24-lmb-sales-pipeline
  project archive  --id 2026.02.24-lmb-sales-pipeline

See also: project-mgmt init | project-mgmt roots
`.trim();

try {
  const workspace      = resolveWorkspace(args);
  const agentWorkspace = resolveAgentWorkspace(args);

  switch (cmd) {
    case 'create':
      create.run(workspace, agentWorkspace, args);
      break;

    case 'list':
      list.run(workspace, args);
      break;

    case 'show':
      show.run(workspace, args);
      break;

    case 'tasks':
      tasksCmd.run(workspace, args);
      break;

    case 'task':
      if (args[0] === 'add') {
        taskCmd.add(workspace, args);
      } else {
        console.error(`Unknown subcommand: task ${args[0]}`);
        console.log('\n' + USAGE);
        process.exit(1);
      }
      break;

    case 'milestone':
      if (args[0] === 'add') {
        milestone.add(workspace, args);
      } else if (args[0] === 'complete') {
        milestone.complete(workspace, args);
      } else {
        console.error(`Unknown subcommand: milestone ${args[0]}`);
        console.log('\n' + USAGE);
        process.exit(1);
      }
      break;

    case 'complete':
      status.run(workspace, args, 'completed');
      break;

    case 'archive':
      status.run(workspace, args, 'archived');
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      console.log('\n' + USAGE);
      process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
