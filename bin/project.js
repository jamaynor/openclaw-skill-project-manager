#!/usr/bin/env node
'use strict';

const { resolveWorkspace } = require('../lib/config');
const create               = require('../lib/commands/create');
const list                 = require('../lib/commands/list');
const status               = require('../lib/commands/status');

const [,, cmd, ...args] = process.argv;
const workspace = resolveWorkspace(args);

const USAGE = `
🗂️  project — OpenClaw Project Commands

Usage:
  project create --name <name> --root <root>   Create a new project
                 [--description <desc>] [--date YYYY-MM-DD] [--workspace <path>]
  project list   [--root <root>] [--status active|completed|archived]
  project complete --id <project-id>           Mark a project complete
  project archive  --id <project-id>           Archive a project
  project help                                 Show this help

Global options:
  --workspace <path>   Override agent workspace path
                       (also: PROJECT_AGENT_WORKSPACE env var)

Examples:
  project create --name "Sales Pipeline" --root lmb-vault --description "Automate lead tracking"
  project create --name "Internal Tool" --root workspace
  project list
  project list --status active --root lmb-vault
  project complete --id 2026.02.24-lmb-sales-pipeline
  project archive  --id 2026.02.24-lmb-sales-pipeline

See also: project-mgmt init | project-mgmt roots
`.trim();

switch (cmd) {
  case 'create':
    create.run(workspace, args);
    break;

  case 'list':
    list.run(workspace, args);
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
    console.log(USAGE);
    process.exit(1);
}
