#!/usr/bin/env node
'use strict';

const { resolveWorkspace } = require('../lib/config');
const { runSetup }         = require('../lib/setup');
const create               = require('../lib/commands/create');
const list                 = require('../lib/commands/list');
const status               = require('../lib/commands/status');
const roots                = require('../lib/commands/roots');

const [,, cmd, ...args] = process.argv;
const workspace = resolveWorkspace(args);

const USAGE = `
🗂️  project-mgmt — OpenClaw Project Manager

Usage:
  project-mgmt init                                  Configure project roots (local + vaults)
  project-mgmt create --name <name> --root <root>    Create a new project
               [--description <desc>] [--date YYYY-MM-DD] [--workspace <path>]
  project-mgmt list [--root <root>] [--status active|completed|archived]
  project-mgmt complete --id <project-id>            Mark a project complete
  project-mgmt archive  --id <project-id>            Archive a project
  project-mgmt roots                                 List configured roots
  project-mgmt help                                  Show this help

Global options:
  --workspace <path>   Override agent workspace path
                       (also: PROJECT_AGENT_WORKSPACE env var)

Examples:
  project-mgmt init
  project-mgmt create --name "Sales Pipeline" --root asd-vault --description "Automate lead tracking"
  project-mgmt create --name "Internal Tool" --root workspace
  project-mgmt list
  project-mgmt list --status active --root asd-vault
  project-mgmt complete --id 2026.02.24-asd-sales-pipeline
  project-mgmt archive  --id 2026.02.24-asd-sales-pipeline
  project-mgmt roots
`.trim();

switch (cmd) {
  case 'init':
    runSetup(workspace).catch(err => { console.error(err.message); process.exit(1); });
    break;

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

  case 'roots':
    roots.run(workspace);
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
