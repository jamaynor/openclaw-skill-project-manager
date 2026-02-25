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

## Workspace path (single-agent setup)

The workspace path resolves in this order:

1. `--workspace <path>` flag passed to any command
2. `PROJECT_AGENT_WORKSPACE` environment variable
3. Current working directory

Set `PROJECT_AGENT_WORKSPACE` in your shell profile to avoid passing `--workspace` on every command:

```bash
export PROJECT_AGENT_WORKSPACE=/path/to/your/workspace
```

## Multi-agent setup

In a multi-agent OpenClaw deployment, one agent owns the project index (the "project manager"), while other agents create and work on projects from their own workspaces.

Two environment variables control this:

| Variable | Purpose |
|----------|---------|
| `PROJECT_MANAGER_WORKSPACE` | Where the config and index live — set this to the PM agent's workspace, **the same value on every agent** |
| `PROJECT_AGENT_WORKSPACE` | The current agent's own workspace — set this **per agent** |

**How workspace resolution works:**

| Priority | Mechanism | Resolves |
|----------|-----------|---------|
| 1 | `--workspace` flag | Manager workspace (admin override) |
| 2 | `PROJECT_MANAGER_WORKSPACE` | Manager workspace |
| 3 | `PROJECT_AGENT_WORKSPACE` | Manager workspace (single-agent fallback) |
| 4 | `cwd` | Manager workspace (last resort) |

`PROJECT_AGENT_WORKSPACE` is used separately to expand `{agent-workspace}` in local root paths, so each agent's local projects land in their own workspace even though the index is shared.

**Example — Nyssa is the PM, Marketer is a sub-agent:**

On every agent (shared environment or Docker config):
```bash
export PROJECT_MANAGER_WORKSPACE=/nyssa/workspace
```

On the marketer agent only:
```bash
export PROJECT_AGENT_WORKSPACE=/marketer/workspace
```

When the marketer runs `project create --root my-vault ...`, the project files go in `/vaults/...` (absolute vault path — unaffected by either variable). When she runs `project create --root local ...`, the files go in `/marketer/workspace/projects/`. Both projects are tracked in Nyssa's index at `/nyssa/workspace/projects/projects-index.json`.

## Re-running setup

You can run `project-mgmt init` again at any time to add new vault roots. Existing roots are preserved.
