import fs   from 'fs';
import path from 'path';
import * as log from './logger.js';

const CONFIG_FILENAME = 'hal-project-manager.json';
const CONFIG_SUBDIR   = 'config';

// Pattern for dated global project index files.
// Format: yyyy.mm.dd-global-project-index.md
const GLOBAL_INDEX_PATTERN = /^\d{4}\.\d{2}\.\d{2}-global-project-index\.md$/;

// ---------------------------------------------------------------------------
// Resolve the manager workspace directory (where config and index live)
// Priority: workspacePath arg > HAL_PROG_MGR_MASTER_WORKSPACE env > cwd
// ---------------------------------------------------------------------------
function resolveWorkspace(workspacePath) {
  if (workspacePath) {
    return path.resolve(workspacePath);
  }
  if (process.env.HAL_PROG_MGR_MASTER_WORKSPACE) {
    const ws = path.resolve(process.env.HAL_PROG_MGR_MASTER_WORKSPACE);
    log.debug('workspace resolved from env', { workspace: ws });
    return ws;
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Resolve the creating agent's own workspace directory
// Used to expand {agent-workspace} in root paths so project files land in the
// correct agent workspace even when the index lives in a different (manager) workspace.
// Priority: agentWorkspacePath > HAL_AGENT_WORKSPACE env > workspacePath > cwd
// ---------------------------------------------------------------------------
function resolveAgentWorkspace(agentWorkspacePath, workspacePath) {
  if (agentWorkspacePath) {
    return path.resolve(agentWorkspacePath);
  }
  if (process.env.HAL_AGENT_WORKSPACE) {
    return path.resolve(process.env.HAL_AGENT_WORKSPACE);
  }
  if (workspacePath) {
    // Backward compatibility: treat workspace as agent workspace
    // when --agent-workspace is not provided.
    return path.resolve(workspacePath);
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Date parsing — local date (not UTC) to avoid timezone off-by-one
// ---------------------------------------------------------------------------
function parseLocalDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) throw new Error(`ERROR: Invalid date '${str}'. Expected YYYY-MM-DD`);
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) {
    throw new Error(`ERROR: Invalid date '${str}'. Date does not exist`);
  }
  return date;
}

function configPath(workspace) {
  return path.join(workspace, CONFIG_SUBDIR, CONFIG_FILENAME);
}

// ---------------------------------------------------------------------------
// globalIndexPath: locate or plan the most recent dated global project index.
//
// The global index is a dated markdown file in {workspace}/projects/:
//   yyyy.mm.dd-global-project-index.md
//
// Strategy:
//   1. List files in {workspace}/projects/ matching the naming pattern.
//   2. Sort filenames descending — the lexicographic sort of yyyy.mm.dd
//      gives chronological order because the date segments are zero-padded.
//   3. Return the path to the most recent file.
//   4. If no matching file exists (first run), return a path for today's date.
//
// WHY dated files: each sweep run creates a new file, preserving history.
// Commands that need to look up projects always use the most recent file.
// ---------------------------------------------------------------------------
function globalIndexPath(workspace) {
  const projectsDir = path.join(workspace, 'projects');

  // Read directory listing; return a new path if the directory doesn't exist yet
  let files = [];
  try {
    files = fs.readdirSync(projectsDir);
  } catch {
    // Directory does not exist yet — this is the first-run case
  }

  // Filter to matching filenames and sort descending so index 0 is most recent
  const matches = files
    .filter(f => GLOBAL_INDEX_PATTERN.test(f))
    .sort()
    .reverse();

  if (matches.length > 0) {
    return path.join(projectsDir, matches[0]);
  }

  // First-run: no existing file — return today's dated path
  const today = new Date();
  const yy    = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, '0');
  const dd    = String(today.getDate()).padStart(2, '0');
  return path.join(projectsDir, `${yy}.${mm}.${dd}-global-project-index.md`);
}

function loadConfig(workspace) {
  const cfgFile = configPath(workspace);
  if (!fs.existsSync(cfgFile)) {
    throw new Error(`ERROR: No config found at ${cfgFile}\nRun: project-mgmt init`);
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    log.debug('config loaded', { path: cfgFile });
    return cfg;
  } catch (e) {
    throw new Error(`ERROR: Config file is not valid JSON: ${cfgFile}\n${e.message}`);
  }
}

function saveConfig(workspace, config) {
  const cfgFile = configPath(workspace);
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2) + '\n');
  log.debug('config saved', { path: cfgFile });
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------
function formatDate(d, sep = '-') {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${sep}${mm}${sep}${dd}`;
}

// ---------------------------------------------------------------------------
// Build the project ID and directory name from config + inputs
// Convention: yyyy.mm.dd-{location}-{slug}  (location omitted for local roots)
// ---------------------------------------------------------------------------
function buildProjectId(root, name, date) {
  const d    = date || new Date();
  const slug = slugify(name);

  const datePart = formatDate(d, '.');
  const code     = root.label || root.location;   // prefer label; fall back for legacy roots
  if (root.type === 'local' || !code) {
    return `${datePart}-${slug}`;
  }
  return `${datePart}-${code}-${slug}`;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Load vault roots from hal-shared-resources in system-config.json.
// Returns an array of root-shaped objects (type: 'vault', label, path+/1-Projects).
// Returns [] if system-config is missing or has no vaults.
// ---------------------------------------------------------------------------
function loadSharedVaults() {
  const configDir = process.env.HAL_SYSTEM_CONFIG || '/data/openclaw/config';
  try {
    const sysConfig = JSON.parse(fs.readFileSync(
      path.join(configDir, 'system-config.json'), 'utf8'));
    const shared = sysConfig['hal-obsidian-vaults'] || [];
    return shared.map(v => ({
      name:        v.name,
      type:        'vault',
      path:        v.path + '/' + (v['projects-folder'] || '1-Projects'),
      label:       v.label,
      description: v.description || '',
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Resolve the root entry from config by name.
// Checks local roots (config.roots) first, then shared vault roots.
// ---------------------------------------------------------------------------
function resolveRoot(config, rootName) {
  const local = config.roots.find(r => r.name === rootName);
  if (local) return local;

  const vaultRoots = loadSharedVaults();
  const vault = vaultRoots.find(r => r.name === rootName);
  if (vault) return vault;

  const allNames = [...config.roots.map(r => r.name), ...vaultRoots.map(r => r.name)].join(', ');
  throw new Error(`ERROR: Unknown root '${rootName}'. Available: ${allNames}`);
}

// ---------------------------------------------------------------------------
// Expand {agent-workspace} placeholder in paths
// ---------------------------------------------------------------------------
function expandPath(p, workspace) {
  return p.replace(/\{agent-workspace\}/g, workspace);
}

export {
  resolveWorkspace,
  resolveAgentWorkspace,
  parseLocalDate,
  configPath,
  globalIndexPath,
  loadConfig,
  saveConfig,
  buildProjectId,
  formatDate,
  slugify,
  resolveRoot,
  expandPath,
  loadSharedVaults,
  GLOBAL_INDEX_PATTERN,
};
