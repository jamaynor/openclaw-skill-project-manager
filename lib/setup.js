import fs       from 'fs';
import path     from 'path';
import readline from 'readline';
import { saveConfig, configPath } from './config.js';
import * as log from './logger.js';

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
function writeSystemConfig(workspace, config, vaultList) {
  const configDir  = process.env.HAL_SYSTEM_CONFIG || '/data/openclaw/config';
  const configFile = path.join(configDir, 'system-config.json');
  let current = { version: '1.0', 'hal-obsidian-vaults': [], skills: {} };
  try {
    current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch { /* first write — use defaults */ }
  current.skills = current.skills || {};
  current['hal-obsidian-vaults'] = current['hal-obsidian-vaults'] || [];

  // Merge detected vaults into hal-obsidian-vaults
  if (vaultList && vaultList.length > 0) {
    const existing = current['hal-obsidian-vaults'];
    const merged = vaultList.map(v => {
      const prev = existing.find(e => e.name === v.name) || {};
      return { ...prev, name: v.name, label: v.label, path: v.path, description: v.description,
               'projects-folder': prev['projects-folder'] || '1-Projects' };
    });
    for (const e of existing) {
      if (!merged.some(m => m.name === e.name)) merged.push(e);
    }
    current['hal-obsidian-vaults'] = merged;
  }

  current.skills['project-manager'] = {
    ...(current.skills['project-manager'] || {}),
    'description':       'Project manager shared settings',
    'environment-variable-prefix': 'HAL_PROG_MGR_',
    'master-workspace':  workspace,
    'naming-convention': config ? config.namingConvention : 'yyyy.mm.dd-{label}-{slug}',
    'roots':             config ? config.roots.filter(r => r.type === 'local') : [],
  };
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(current, null, 2) + '\n');
    return configFile;
  } catch (err) {
    console.warn(`  WARN: Could not write HAL system config: ${err.message}`);
    log.warn('system config write failed', { error: err.message });
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

// Infer a short label from a vault folder name.
// "ja-vault" → "ja",  "lmb-vault" → "lmb",  "personal" → "personal"
function inferLabel(folderName) {
  return folderName.toLowerCase().replace(/-vault$/, '').replace(/[^a-z0-9]/g, '-');
}

// ---------------------------------------------------------------------------
// Setup wizard
// Accepts an optional opts object for non-interactive mode.
// When both opts.projectManagerAgent and opts.vaultsRoot are provided,
// runs headlessly without any readline prompts.
// ---------------------------------------------------------------------------
async function runSetup(defaultWorkspace, opts = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ---------------------------------------------------------------------------
  // Non-interactive (headless) path
  // Both --project-manager-agent AND --vaults-root must be provided.
  // If only one is provided, fall through to interactive mode.
  // ---------------------------------------------------------------------------
  if (opts.projectManagerAgent && opts.vaultsRoot) {
    try {
      const agents = readAgents();
      const agent  = agents.find(a => a.id === opts.projectManagerAgent);
      if (!agent) {
        throw new Error(`ERROR: Agent not found: ${opts.projectManagerAgent}`);
      }

      const workspace = agent.workspace;
      log.debug('non-interactive init: agent selected', { agent: opts.projectManagerAgent, workspace });

      const detected  = detectVaults(opts.vaultsRoot);
      const vaultList = detected.map(vault => ({
        name:        vault.name,
        label:       inferLabel(vault.name),
        path:        vault.path,
        description: `${vault.name} Obsidian vault`,
      }));

      const config = {
        namingConvention: 'yyyy.mm.dd-{location}-{slug}',
        dueSoonDays:      7,
        roots: [
          {
            name:        'workspace',
            type:        'local',
            path:        `{agent-workspace}/projects`,
            description: 'Local workspace projects',
          },
        ],
      };

      saveConfig(workspace, config);
      const sysConfigPath = writeSystemConfig(workspace, config, vaultList);
      if (sysConfigPath) log.debug('system config written', { path: sysConfigPath });

      log.info('non-interactive setup complete', { workspace, agentId: opts.projectManagerAgent });
      console.log('Setup complete (non-interactive).');
      return;
    } finally {
      rl.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Interactive wizard (existing path)
  // ---------------------------------------------------------------------------
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
      log.debug('agent selected', { agent: agentName, workspace });
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
      dueSoonDays:      7,
      roots: existingConfig ? existingConfig.roots.slice() : [],
    };

    // ── Step 2: Local root ──────────────────────────────────────────────────
    const hasLocal = config.roots.some(r => r.type === 'local');
    if (!hasLocal) {
      config.roots.push({
        name:        'workspace',
        type:        'local',
        path:        `{agent-workspace}/projects`,
        description: 'Local workspace projects',
      });
    }
    console.log('--- Quick Projects ---');
    console.log('Each agent gets its own local projects folder for temporary or');
    console.log('internal work that doesn\'t need to appear in your Obsidian vault.');
    console.log('  ✓ Enabled — projects will be stored in each agent\'s workspace:');
    console.log('    {agent-workspace}/projects/\n');

    // ── Step 3: Obsidian vault roots ────────────────────────────────────────
    console.log('--- Obsidian Vault Roots ---');

    const defaultVaultsRoot = process.env.HAL_VAULT_ROOT || '/vaults';
    const vaultsRootInput   = await prompt(rl, 'Where are your Obsidian Vaults located?', defaultVaultsRoot);
    const vaultsRoot        = vaultsRootInput.replace(/\/+$/, '') || defaultVaultsRoot;

    const detected  = detectVaults(vaultsRoot);
    const vaultList = [];

    if (detected.length === 0) {
      console.log(`\nNo vaults found at ${vaultsRoot}.\n`);
    } else {
      log.debug('vaults detected', { count: detected.length, path: vaultsRoot });
      console.log('');
      for (const vault of detected) {
        const label = inferLabel(vault.name);
        vaultList.push({
          name:        vault.name,
          label,
          path:        vault.path,
          description: `${vault.name} Obsidian vault`,
        });
        console.log(`  ✓ ${vault.name}`);
      }
      console.log('');
    }

    // ── Save ────────────────────────────────────────────────────────────────
    saveConfig(workspace, config);

    const sysConfigPath = writeSystemConfig(workspace, config, vaultList);
    if (sysConfigPath) console.log(`✅ HAL system config updated → ${sysConfigPath}`);

    log.info('setup complete', { workspace, rootCount: config.roots.length });
    console.log('\n✅ Setup complete.\n');

    if (vaultList.length > 0) {
      console.log('Obsidian vaults:');
      for (const v of vaultList) {
        console.log(`  ${v.name}  →  ${v.path}/1-Projects`);
      }
      console.log('');
    }
    console.log('Quick local projects enabled for all agents.');
    console.log('\nTo create a project:');
    console.log('  project create --name "My Project" --root <vault-name> --due YYYY-MM-DD --goals "..."');

  } finally {
    rl.close();
  }
}

export { runSetup, readAgents, writeSystemConfig, detectVaults, inferLabel };
