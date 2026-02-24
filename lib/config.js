'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'project-manager.json';
const INDEX_FILENAME  = 'projects-index.json';
const CONFIG_SUBDIR   = 'config';

// ---------------------------------------------------------------------------
// Resolve the agent workspace directory
// Priority: --workspace flag > PROJECT_AGENT_WORKSPACE env > cwd
// ---------------------------------------------------------------------------
function resolveWorkspace(args) {
  const flagIdx = args.indexOf('--workspace');
  if (flagIdx !== -1 && args[flagIdx + 1]) return path.resolve(args[flagIdx + 1]);
  if (process.env.PROJECT_AGENT_WORKSPACE) return path.resolve(process.env.PROJECT_AGENT_WORKSPACE);
  return process.cwd();
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
    console.error(`No config found at ${cfgFile}`);
    console.error('Run: project-mgmt init');
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Config file is not valid JSON: ${cfgFile}`);
    console.error(e.message);
    process.exit(1);
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
    console.error(`ERROR: Index file is not valid JSON: ${idxFile}`);
    console.error(e.message);
    process.exit(1);
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
    console.error(`Unknown root '${rootName}'. Available: ${names}`);
    process.exit(1);
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
