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
🗂️  project — OpenClaw Project Manager

Usage:
  project setup                                  Interactive config wizard
  project create --name <name> --root <root>     Create a new project
           [--description <desc>] [--date YYYY-MM-DD] [--workspace <path>]
  project list [--root <root>] [--status active|completed|archived]
  project complete --id <project-id>             Mark a project complete
  project archive  --id <project-id>             Archive a project
  project roots                                  List configured roots
  project help                                   Show this help

Global options:
  --workspace <path>   Override agent workspace path
                       (also: PROJECT_AGENT_WORKSPACE env var)

Examples:
  project setup
  project create --name "Sales Pipeline" --root asd-vault --description "Automate lead tracking"
  project create --name "Internal Tool" --root workspace
  project list
  project list --status active --root asd-vault
  project complete --id 2026.02.24-asd-sales-pipeline
  project archive  --id 2026.02.24-asd-sales-pipeline
  project roots
`.trim();

switch (cmd) {
  case 'setup':
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
