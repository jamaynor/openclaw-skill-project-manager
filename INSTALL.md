# Installation

## Prerequisites

- Node.js 18 or later

## Install

```bash
npm install -g openclaw-skill-project-manager
```

This installs two global binaries: `project` and `project-mgmt`.

## First-time setup

Run the interactive wizard once per agent workspace to configure where projects live:

```bash
project-mgmt init
```

The wizard asks for:

- **Local root** — a directory inside your agent workspace for local projects (e.g. `{agent-workspace}/projects/`)
- **Vault roots** — one or more Obsidian vault folders (e.g. `/vaults/lmb-vault/1-Projects/`); each gets a short **location code** used in project IDs (e.g. `lmb`)

Configuration is saved to `{workspace}/config/project-manager.json`.

## Verify the installation

```bash
project-mgmt roots    # list configured roots
project list          # list all projects (empty on a fresh install)
```

## Workspace path

The workspace path resolves in this order:

1. `--workspace <path>` flag passed to any command
2. `HAL_PROJ_MGR_MASTER_WORKSPACE` environment variable
3. Current working directory

## HAL system configuration

In a HAL deployment, workspace paths are declared in a central config file rather
than set individually per container:

**`/data/openclaw/config/system-config.json`**
```json
{
  "version": "1.0",
  "skills": {
    "project-manager": {
      "master-workspace": "/data/agents/project-manager"
    }
  }
}
```

At container startup, source `hal-env-init.sh` to export `HAL_PROJ_MGR_MASTER_WORKSPACE`
(and all other skill vars) from this file:

```bash
source /path/to/hal-env-init.sh
```

`project-mgmt init` writes the master workspace into `system-config.json` automatically.

**Workspace resolution:**

| Priority | Mechanism                        |
|----------|----------------------------------|
| 1        | `--workspace` flag               |
| 2        | `HAL_PROJ_MGR_MASTER_WORKSPACE`  |
| 3        | Current working directory        |

## Re-running setup

You can run `project-mgmt init` again at any time to add new vault roots. Existing roots are preserved.
