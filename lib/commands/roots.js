import { loadConfig, loadSharedVaults, expandPath } from '../config.js';
import * as log from '../logger.js';

function run(workspace, agentWorkspace) {
  const config     = loadConfig(workspace);
  const vaultRoots = loadSharedVaults();
  const allRoots   = [...config.roots, ...vaultRoots];
  log.info('roots listed', { count: allRoots.length });
  console.log('\nConfigured roots:\n');
  for (const r of allRoots) {
    const lbl = (r.label || r.location) ? `label: ${r.label || r.location}` : 'no label';
    console.log(`  [${r.type}] ${r.name}`);
    console.log(`    path: ${expandPath(r.path, agentWorkspace)}`);
    console.log(`    ${lbl}`);
    if (r.description) console.log(`    ${r.description}`);
    console.log('');
  }
}

export { run };
