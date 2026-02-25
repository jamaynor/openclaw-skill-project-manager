'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { saveConfig, configPath } = require('./config');

// ---------------------------------------------------------------------------
// Read the list of agents from openclaw.json.
// Derives the path from HAL_SYSTEM_CONFIG (../../openclaw.json relative to
// the config dir, i.e. /data/openclaw/config/../openclaw.json).
// Returns [] if the file cannot be read or has no agents.
// ---------------------------------------------------------------------------
function readAgents() {
  const configDir     = process.env.HAL_SYSTEM_CONFIG || '/data/openclaw/config';
  const openclawPath  = path.join(configDir, '..', 'openclaw.json');
  try {
    const raw = JSON.parse(fs.readFileSync(openclawPath, 'utf8'));
    return (raw.agents && Array.isArray(raw.agents.list)) ? raw.agents.list : [];
  } catch {
    return [];
  }
}

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
// Detect vault directories under a root path.
// Returns [{ name, path }] for every subdirectory found.
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
// "ja-vault" → "ja",  "lmb-vault" → "lmb",  "personal" → "personal"
function inferLocation(folderName) {
  return folderName.toLowerCase().replace(/-vault$/, '').replace(/[^a-z0-9]/g, '-');
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
async function runSetup(defaultWorkspace) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🗂️  Project Manager Setup\n');

  try {

    // ── Step 1: Select the Project Manager agent ────────────────────────────
    const agents = readAgents();
    let workspace = defaultWorkspace;

    if (agents.length === 0) {
      console.log('(Could not read agents from openclaw.json — using default workspace)');
      console.log(`Workspace: ${workspace}\n`);
    } else {
      console.log('All agents can create and manage projects. One agent serves as');
      console.log('Project Manager — its workspace holds the shared project index');
      console.log('that every other agent reads and writes to.\n');

      agents.forEach((a, i) => {
        const name  = (a.identity && a.identity.name)  ? a.identity.name  : a.id;
        const emoji = (a.identity && a.identity.emoji) ? a.identity.emoji + ' ' : '';
        console.log(`  ${i + 1}.  ${emoji}${name}`);
        console.log(`       workspace: ${a.workspace}`);
      });
      console.log('');

      let selection = 0;
      while (selection < 1 || selection > agents.length) {
        const raw = await prompt(rl, `Which agent will be Project Manager? (1-${agents.length})`);
        selection = parseInt(raw, 10);
        if (isNaN(selection) || selection < 1 || selection > agents.length) {
          console.log(`  Please enter a number between 1 and ${agents.length}.`);
          selection = 0;
        }
      }

      const selected  = agents[selection - 1];
      workspace       = selected.workspace;
      const agentName = (selected.identity && selected.identity.name) ? selected.identity.name : selected.id;
      console.log(`\n  ✓ ${agentName} is the Project Manager\n`);
    }

    console.log(`Config will be saved to: ${configPath(workspace)}\n`);

    // ── Check for existing config ───────────────────────────────────────────
    const existingConfig = (() => {
      try { return JSON.parse(fs.readFileSync(configPath(workspace), 'utf8')); }
      catch { return null; }
    })();

    if (existingConfig) {
      const overwrite = await promptYesNo(rl, 'Config already exists. Overwrite?', false);
      if (!overwrite) { console.log('Aborted.'); return; }
    }

    const config = {
      namingConvention: 'yyyy.mm.dd-{location}-{slug}',
      roots: existingConfig ? existingConfig.roots.slice() : [],
    };

    // ── Step 2: Local root ──────────────────────────────────────────────────
    console.log('--- Quick Projects (optional) ---');
    console.log('In addition to vault projects, agents can create lightweight projects');
    console.log('stored directly in their own workspace — useful for temporary or');
    console.log('internal work that doesn\'t need to appear in your Obsidian vault.');
    console.log('Each agent gets its own local projects folder.\n');

    const hasLocal = config.roots.some(r => r.type === 'local');
    if (hasLocal) {
      console.log('Quick local projects already enabled — keeping existing.\n');
    } else {
      const addLocal = await promptYesNo(rl, 'Enable quick local projects?', false);
      if (addLocal) {
        config.roots.push({
          name:        'workspace',
          type:        'local',
          path:        `{agent-workspace}/projects`,
          location:    null,
          description: 'Local workspace projects',
        });
        console.log('');
      }
    }

    // ── Step 3: Obsidian vault roots ────────────────────────────────────────
    console.log('--- Obsidian Vault Roots ---');

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

    // Option to add a vault at a custom path
    const addCustom = await promptYesNo(rl, 'Add a vault at a custom path?', false);
    if (addCustom) {
      console.log('');
      const vaultPath  = await prompt(rl, 'Full path to vault');
      const normalised = vaultPath.replace(/\/+$/, '');
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

    // ── Save ────────────────────────────────────────────────────────────────
    saveConfig(workspace, config);

    const sysConfigPath = writeSystemConfig(workspace);
    if (sysConfigPath) console.log(`✅ HAL system config updated → ${sysConfigPath}`);

    console.log('\n✅ Config saved.\n');
    console.log('Configured roots:');
    for (const r of config.roots) {
      const loc = r.location ? `  location: ${r.location}` : '';
      console.log(`  [${r.type}] ${r.name} → ${r.path}${loc}`);
    }
    console.log('\nNext: project create --name "My Project" --root <root-name> --due YYYY-MM-DD --goals "..."');

  } finally {
    rl.close();
  }
}

module.exports = { runSetup };
