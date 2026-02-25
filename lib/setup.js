'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { saveConfig, configPath } = require('./config');

// ---------------------------------------------------------------------------
// Write project-manager entry into the HAL system config.
// Reads existing config, merges, and writes back.
// ---------------------------------------------------------------------------
function writeSystemConfig(workspace) {
  const configDir  = process.env.HAL_SYSTEM_CONFIG || '/data/openclaw/config';
  const configFile = path.join(configDir, 'system-config.json');
  let current = { version: '1.0', 'vaults-root': '/vaults', skills: {} };
  try {
    current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch { /* first write — use defaults */ }
  current.skills = current.skills || {};
  current.skills['project-manager'] = {
    ...(current.skills['project-manager'] || {}),
    'master-workspace': workspace,
  };
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(current, null, 2) + '\n');
    return configFile;
  } catch (err) {
    console.warn(`  WARN: Could not write HAL system config: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------
function prompt(rl, question, defaultVal) {
  return new Promise(resolve => {
    const display = defaultVal !== undefined ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(display, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function promptYesNo(rl, question, defaultVal = true) {
  const hint = defaultVal ? 'Y/n' : 'y/N';
  return new Promise(resolve => {
    rl.question(`${question} (${hint}): `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultVal);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
async function runSetup(workspace) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🗂️  Project Manager Setup\n');
  console.log('This wizard creates your project-manager.json config.');
  console.log(`Config will be saved to: ${configPath(workspace)}\n`);

  const existingConfig = (() => {
    try { return JSON.parse(fs.readFileSync(configPath(workspace), 'utf8')); }
    catch { return null; }
  })();

  try {
    if (existingConfig) {
      const overwrite = await promptYesNo(rl, 'Config already exists. Overwrite?', false);
      if (!overwrite) { console.log('Aborted.'); return; }
    }

    // Preserve existing roots when reconfiguring so re-init doesn't wipe them.
    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: existingConfig ? existingConfig.roots.slice() : [],
    };

    // ---- Local root (agent workspace) ------------------------------------
    console.log('\n--- Local Root (Agent Workspace) ---');
    console.log('A local root creates projects inside your agent workspace.');
    console.log(`  Path: ${workspace}/projects/`);
    const hasLocal = config.roots.some(r => r.type === 'local');
    if (hasLocal) {
      console.log('Local root already configured — keeping existing.');
    } else {
      const addLocal = await promptYesNo(rl, 'Add a local workspace root?', true);
      if (addLocal) {
        const localSubdir = await prompt(rl, 'Subdirectory name inside workspace', 'projects');
        config.roots.push({
          name:        'workspace',
          type:        'local',
          path:        `{agent-workspace}/${localSubdir}`,
          location:    null,
          description: 'Local agent workspace projects',
        });
      }
    }

    // ---- Vault roots -------------------------------------------------------
    console.log('\n--- Vault Roots (Obsidian Vaults) ---');
    console.log('Vault roots create projects inside an Obsidian vault folder.');
    const existingVaults = config.roots.filter(r => r.type === 'vault');
    if (existingVaults.length > 0) {
      console.log(`${existingVaults.length} existing vault root(s) preserved. Add new ones below.`);
    }

    let addMore = await promptYesNo(rl, 'Add a vault root?', true);
    while (addMore) {
      console.log('');
      const name        = await prompt(rl, 'Root name (e.g. lmb-vault, personal)');
      const vaultPath   = await prompt(rl, 'Full path to vault (e.g. /vaults/lmb-vault)');
      const subfolder   = await prompt(rl, 'Projects subfolder inside vault', '1-Projects');
      const location    = await prompt(rl, 'Location code for naming (e.g. lmb, ja)');
      const description = await prompt(rl, 'Description (optional)', '');

      const normalizedPath = vaultPath.replace(/\/+$/, '');
      if (!fs.existsSync(normalizedPath)) {
        console.warn(`  WARN: Path does not exist: ${normalizedPath}`);
      }

      config.roots.push({
        name,
        type:     'vault',
        path:     normalizedPath + '/' + subfolder,
        location: location || null,
        description,
      });

      addMore = await promptYesNo(rl, '\nAdd another vault root?', false);
    }

    if (config.roots.length === 0) {
      console.error('\nNo roots configured — nothing to save.');
      return;
    }

    saveConfig(workspace, config);

    const sysConfigPath = writeSystemConfig(workspace);
    if (sysConfigPath) console.log(`✅ HAL system config updated → ${sysConfigPath}`);

    console.log('\n✅ Config saved.\n');
    console.log('Configured roots:');
    for (const r of config.roots) {
      const loc = r.location ? `location: ${r.location}` : '(no location code)';
      console.log(`  [${r.type}] ${r.name} → ${r.path}`);
      console.log(`    ${loc}`);
    }
    console.log('\nNext: project create --name "My Project" --root <root-name>');
  } finally {
    rl.close();
  }
}

module.exports = { runSetup };
