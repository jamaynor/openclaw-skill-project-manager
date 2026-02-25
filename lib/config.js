'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'project-manager.json';
const INDEX_FILENAME  = 'projects-index.json';
const CONFIG_SUBDIR   = 'config';

// ---------------------------------------------------------------------------
// Resolve the manager workspace directory (where config and index live)
// Priority: --workspace flag > PROJECT_MANAGER_WORKSPACE env > PROJECT_AGENT_WORKSPACE env > cwd
// ---------------------------------------------------------------------------
function resolveWorkspace(args) {
  const flagIdx = args.indexOf('--workspace');
  if (flagIdx !== -1) {
    if (!args[flagIdx + 1] || args[flagIdx + 1].startsWith('--')) {
      throw new Error('ERROR: --workspace requires a path argument');
    }
    return path.resolve(args[flagIdx + 1]);
  }
  if (process.env.PROJECT_MANAGER_WORKSPACE) return path.resolve(process.env.PROJECT_MANAGER_WORKSPACE);
  if (process.env.PROJECT_AGENT_WORKSPACE)   return path.resolve(process.env.PROJECT_AGENT_WORKSPACE);
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Resolve the creating agent's own workspace directory
// Used to expand {agent-workspace} in root paths so project files land in the
// correct agent workspace even when the index lives in a different (manager) workspace.
// Priority: PROJECT_AGENT_WORKSPACE env > cwd
// (Not affected by --workspace flag or PROJECT_MANAGER_WORKSPACE)
// ---------------------------------------------------------------------------
function resolveAgentWorkspace() {
  if (process.env.PROJECT_AGENT_WORKSPACE) return path.resolve(process.env.PROJECT_AGENT_WORKSPACE);
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Shared CLI argument parser
// Skips --workspace (already consumed by resolveWorkspace).
// Boolean flags (--json) → true. Repeated flags (--criteria) → array.
// ---------------------------------------------------------------------------
function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    if (args[i] === '--workspace') { i++; continue; }
    const key = args[i].slice(2);
    const hasValue = i + 1 < args.length && !args[i + 1].startsWith('--');
    const val = hasValue ? args[++i] : true;
    if (key in opts) {
      // Accumulate repeated flags (e.g. --criteria "a" --criteria "b") into an array
      if (!Array.isArray(opts[key])) opts[key] = [opts[key]];
      opts[key].push(val);
    } else {
      opts[key] = val;
    }
  }
  return opts;
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

function indexPath(workspace) {
  return path.join(workspace, 'projects', INDEX_FILENAME);
}

function loadConfig(workspace) {
  const cfgFile = configPath(workspace);
  if (!fs.existsSync(cfgFile)) {
    throw new Error(`ERROR: No config found at ${cfgFile}\nRun: project-mgmt init`);
  }
  try {
    return JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (e) {
    throw new Error(`ERROR: Config file is not valid JSON: ${cfgFile}\n${e.message}`);
  }
}

function saveConfig(workspace, config) {
  const cfgFile = configPath(workspace);
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2) + '\n');
}

function loadIndex(workspace) {
  const idxFile = indexPath(workspace);
  if (!fs.existsSync(idxFile)) {
    return { version: '1.0', projects: [], lastUpdated: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  } catch (e) {
    throw new Error(`ERROR: Index file is not valid JSON: ${idxFile}\n${e.message}`);
  }
}

function saveIndex(workspace, index) {
  const idxFile = indexPath(workspace);
  fs.mkdirSync(path.dirname(idxFile), { recursive: true });
  index.lastUpdated = new Date().toISOString();
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 2) + '\n');
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
  if (root.type === 'local' || !root.location) {
    return `${datePart}-${slug}`;
  }
  return `${datePart}-${root.location}-${slug}`;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Resolve the root entry from config by name
// ---------------------------------------------------------------------------
function resolveRoot(config, rootName) {
  const root = config.roots.find(r => r.name === rootName);
  if (!root) {
    const names = config.roots.map(r => r.name).join(', ');
    throw new Error(`ERROR: Unknown root '${rootName}'. Available: ${names}`);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Expand {agent-workspace} placeholder in paths
// ---------------------------------------------------------------------------
function expandPath(p, workspace) {
  return p.replace(/\{agent-workspace\}/g, workspace);
}

module.exports = {
  resolveWorkspace,
  resolveAgentWorkspace,
  parseArgs,
  parseLocalDate,
  configPath,
  indexPath,
  loadConfig,
  saveConfig,
  loadIndex,
  saveIndex,
  buildProjectId,
  formatDate,
  slugify,
  resolveRoot,
  expandPath,
};
