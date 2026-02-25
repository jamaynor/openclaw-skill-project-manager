'use strict';

const { loadConfig, expandPath } = require('../config');

function run(workspace, agentWorkspace) {
  const config = loadConfig(workspace);
  console.log('\nConfigured roots:\n');
  for (const r of config.roots) {
    const loc = r.location ? `location: ${r.location}` : 'no location code';
    console.log(`  [${r.type}] ${r.name}`);
    console.log(`    path: ${expandPath(r.path, agentWorkspace)}`);
    console.log(`    ${loc}`);
    if (r.description) console.log(`    ${r.description}`);
    console.log('');
  }
}

module.exports = { run };
