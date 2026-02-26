#!/usr/bin/env node
'use strict';

const { resolveWorkspace, resolveAgentWorkspace } = require('../lib/config');
const { runSetup }         = require('../lib/setup');
const roots                = require('../lib/commands/roots');

const [,, cmd, ...args] = process.argv;

const USAGE = `
project-mgmt — OpenClaw Project Manager Configuration

Usage:
  project-mgmt init                  Configure project roots (local + vaults)
  project-mgmt roots                 List configured roots
  project-mgmt help                  Show this help

Global options:
  --workspace <path>   Override agent workspace path
                       (also: HAL_PROG_MGR_MASTER_WORKSPACE env var)

Examples:
  project-mgmt init
  project-mgmt roots

See also: project create | project list | project complete | project archive
`.trim();

async function main() {
  const workspace      = resolveWorkspace(args);
  const agentWorkspace = resolveAgentWorkspace(args);

  switch (cmd) {
    case 'init':
      await runSetup(workspace);
      break;

    case 'roots':
      roots.run(workspace, agentWorkspace);
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
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
