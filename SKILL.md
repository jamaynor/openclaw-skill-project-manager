---
name: project-manager
description: >
  Create and track projects deterministically across agent workspaces and Obsidian
  vaults. Use when creating a new project, listing active projects, marking a project
  complete or archived, or setting up project tracking for the first time. Projects
  are created with consistent dated IDs and tracked in a predictable index file.
homepage: https://github.com/jamaynor/openclaw-skill-project-manager
metadata:
  {
    "openclaw":
      {
        "emoji": "🗂️",
        "requires": {},
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "openclaw-skill-project-manager",
              "bins": ["project", "project-mgmt"],
              "label": "Install project-manager skill (node)",
            },
          ],
      },
  }
---

# project-manager

Create and track projects deterministically. Every project gets a consistent
dated ID, a directory in the right place (vault or local workspace), and an
entry in `projects-index.json` in your agent workspace.

Two binaries are installed:
- **`project`** — work with individual projects (create, list, complete, archive)
- **`project-mgmt`** — configure and inspect the system (init, roots)

## First-Time Setup

Run the interactive setup wizard to configure your roots:

```bash
project-mgmt init
```

The wizard will ask about:
- **Local root** — projects created inside your agent workspace (`{workspace}/projects/`)
- **Vault roots** — projects created inside Obsidian vault folders (e.g. `/vaults/lmb-vault/1-Projects/`)
- Each vault root gets a **location code** used in the project ID (e.g. `lmb`, `ja`)

Config is saved to: `{agent-workspace}/config/project-manager.json`

## Project ID Format

```
yyyy.mm.dd-{location}-{slug}    # vault root with location code
yyyy.mm.dd-{slug}               # local workspace root (no location)
```

Examples:
- `2026.02.24-lmb-sales-pipeline`
- `2026.02.24-lmb-private-events`
- `2026.02.24-internal-tool`

## Project Commands (`project`)

```bash
# Create a project in a vault root
project create --name "Sales Pipeline" --root lmb-vault --description "Automate lead tracking"

# Create a project in the local workspace
project create --name "Internal Tool" --root workspace

# List all projects
project list

# List active projects in a specific root
project list --status active --root lmb-vault

# Mark complete or archive
project complete --id 2026.02.24-lmb-sales-pipeline
project archive  --id 2026.02.24-lmb-sales-pipeline
```

## Management Commands (`project-mgmt`)

```bash
# Configure roots (run once per agent workspace)
project-mgmt init

# Show configured roots
project-mgmt roots
```

## Index File

Always at: `{agent-workspace}/projects/projects-index.json`

```json
{
  "version": "1.0",
  "projects": [
    {
      "id": "2026.02.24-lmb-sales-pipeline",
      "name": "Sales Pipeline Automation",
      "root": "lmb-vault",
      "rootType": "vault",
      "path": "/vaults/lmb-vault/1-Projects/2026.02.24-lmb-sales-pipeline",
      "location": "lmb",
      "startDate": "2026-02-24",
      "completionDate": null,
      "archivedDate": null,
      "status": "active",
      "description": "Automate lead tracking"
    }
  ],
  "lastUpdated": "2026-02-24T10:00:00Z"
}
```

## Environment Variables

| Variable                  | Description                                 |
|---------------------------|---------------------------------------------|
| `PROJECT_AGENT_WORKSPACE` | Path to agent workspace (sets default root) |

Or pass `--workspace <path>` to any command.
