#!/usr/bin/env node

import { Command } from 'commander';
import { resolveWorkspace, resolveAgentWorkspace } from '../lib/config.js';
import * as log     from '../lib/logger.js';
import { runSetup } from '../lib/setup.js';
import * as roots   from '../lib/commands/roots.js';
import * as sweep   from '../lib/commands/sweep.js';
import * as migrate from '../lib/commands/migrate.js';
import * as prune   from '../lib/commands/prune.js';

let workspace;
let agentWorkspace;

const program = new Command();

program
  .name('project-mgmt')
  .description('OpenClaw Project Manager Configuration')
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

// project-mgmt init
program
  .command('init')
  .description('Configure project roots (local + vaults)')
  .option('--project-manager-agent <agent-id>', 'Agent ID to use as Project Manager (non-interactive)')
  .option('--vaults-root <path>', 'Vault root path for auto-detection (non-interactive)')
  .action(async (opts) => {
    await runSetup(workspace, opts);
  });

// project-mgmt roots
program
  .command('roots')
  .description('List configured roots')
  .action(() => {
    roots.run(workspace, agentWorkspace);
  });

// project-mgmt sweep
program
  .command('sweep')
  .description('Aggregate all project-index.md files into a dated global index')
  .action((opts) => {
    sweep.run(workspace, agentWorkspace, opts);
  });

// project-mgmt migrate
program
  .command('migrate')
  .description('Bulk-migrate README.md + tasks.md to project-index.md')
  .action((opts) => {
    migrate.run(workspace, agentWorkspace, opts);
  });

// project-mgmt prune
program
  .command('prune')
  .description('Archive and delete global index files older than --days days')
  .option('--days <n>', 'Retention window in days (default: 30)', '30')
  .action((opts) => {
    prune.run(workspace, agentWorkspace, opts);
  });

program.parseAsync(process.argv).catch(err => {
  log.error('command failed', { error: err.message });
  log.close();
  console.error(err.message);
  process.exit(1);
});
