'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { saveConfig, configPath } = require('./config');

// ---------------------------------------------------------------------------
// Write project-manager entry into the HAL system config.
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
// Prompt helpers
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
// Detect Obsidian vaults under a root directory.
// Returns [{ name, path }] — any subdirectory qualifies.
// ---------------------------------------------------------------------------
function detectVaults(vaultsRoot) {
  try {
    return fs.readdirSync(vaultsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(vaultsRoot, e.name) }));
  } catch {
    return [];
  }
}

// Infer a short location code from a vault folder name.
// "ja-vault" → "ja", "lmb-vault" → "lmb", "personal" → "personal"
function inferLocation(folderName) {
  return folderName.toLowerCase().replace(/-vault$/, '').replace(/[^a-z0-9]/g, '-');
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

    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: existingConfig ? existingConfig.roots.slice() : [],
    };

    // ── Local root ───────────────────────────────────────────────────────────
    console.log('\n--- Local Root ---');
    console.log('A local root stores projects inside your agent workspace.');
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

    // ── Vault roots ──────────────────────────────────────────────────────────
    console.log('\n--- Obsidian Vault Roots ---');

    const defaultVaultsRoot = process.env.HAL_VAULTS_ROOT || '/vaults';
    const vaultsRootInput   = await prompt(rl, 'Where are your Obsidian Vaults located?', defaultVaultsRoot);
    const vaultsRoot        = vaultsRootInput.replace(/\/+$/, '') || defaultVaultsRoot;

    const detected = detectVaults(vaultsRoot);

    if (detected.length === 0) {
      console.log(`\nNo directories found at ${vaultsRoot}.`);
    } else {
      console.log(`\nFound ${detected.length} vault(s):\n`);
      detected.forEach((v, i) => console.log(`  ${i + 1}. ${v.name}  (${v.path})`));
      console.log('');

      for (const vault of detected) {
        // Skip already-configured vaults
        const alreadyAdded = config.roots.some(r => r.type === 'vault' && r.path.startsWith(vault.path));
        if (alreadyAdded) {
          console.log(`  ${vault.name} — already configured, skipping.`);
          continue;
        }

        const add = await promptYesNo(rl, `Add "${vault.name}"?`, true);
        if (!add) continue;

        const inferredLoc = inferLocation(vault.name);
        const location    = await prompt(rl, '  Location code for project IDs (e.g. ja, lmb)', inferredLoc);
        const subfolder   = await prompt(rl, '  Projects subfolder inside vault', '1-Projects');
        const rootName    = await prompt(rl, '  Root name (used with --root flag)', vault.name);

        config.roots.push({
          name:        rootName,
          type:        'vault',
          path:        vault.path + '/' + subfolder,
          location:    location || null,
          description: `${vault.name} Obsidian vault`,
        });
        console.log(`  ✓ Added root "${rootName}"\n`);
      }
    }

    // Option to add a custom vault path not in the detected list
    const addCustom = await promptYesNo(rl, 'Add a vault at a custom path?', false);
    if (addCustom) {
      console.log('');
      const vaultPath   = await prompt(rl, 'Full path to vault');
      const normalised  = vaultPath.replace(/\/+$/, '');
      if (!fs.existsSync(normalised)) {
        console.warn(`  WARN: Path does not exist: ${normalised}`);
      }
      const inferredLoc = inferLocation(path.basename(normalised));
      const location    = await prompt(rl, 'Location code for project IDs', inferredLoc);
      const subfolder   = await prompt(rl, 'Projects subfolder inside vault', '1-Projects');
      const rootName    = await prompt(rl, 'Root name (used with --root flag)', path.basename(normalised));

      config.roots.push({
        name:        rootName,
        type:        'vault',
        path:        normalised + '/' + subfolder,
        location:    location || null,
        description: `${path.basename(normalised)} Obsidian vault`,
      });
      console.log(`  ✓ Added root "${rootName}"\n`);
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
      const loc = r.location ? `  location code: ${r.location}` : '';
      console.log(`  [${r.type}] ${r.name} → ${r.path}${loc}`);
    }
    console.log('\nNext: project create --name "My Project" --root <root-name>');
  } finally {
    rl.close();
  }
}

module.exports = { runSetup };
