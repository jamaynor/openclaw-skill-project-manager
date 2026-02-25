---
name: project-manager
description: >
  Create and track projects deterministically across agent workspaces and Obsidian
  vaults. Use when creating a new project, listing active projects, inspecting a
  project's details, marking a project complete or archived, or setting up project
  tracking for the first time. Projects are created with consistent dated IDs and
  tracked in a predictable index file. Vault projects are seeded with Obsidian
  Dataview-compatible YAML frontmatter that stays in sync with project status.
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
- **`project`** — work with individual projects (create, list, show, tasks, complete, archive, milestone)
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
# Create a project (--due and --goals are required)
project create --name "Sales Pipeline" --root lmb-vault --due 2026-06-30 \
  --goals "Automate lead tracking from all sources into a single pipeline" \
  --description "Brief one-liner shown in project list"

# Create a project in the local workspace
project create --name "Internal Tool" --root workspace --due 2026-04-15 \
  --goals "Build an internal CLI for batch processing customer exports"

# List all projects
project list

# List active projects in a specific root
project list --status active --root lmb-vault

# Machine-readable list (for plan-day and other skills)
project list --json
project list --status active --json

# Inspect a single project
project show --id 2026.02.24-lmb-sales-pipeline

# Add a task to a project
project task add --id 2026.02.24-lmb-sales-pipeline \
  --title "Map existing lead sources" \
  --description "Identify all current lead entry points and document them." \
  --worker-type node \
  --criteria "All lead sources listed" \
  --criteria "Owner identified for each source"

# Read a project's task list
project tasks --id 2026.02.24-lmb-sales-pipeline
project tasks --id 2026.02.24-lmb-sales-pipeline --json

# Add and complete milestones
project milestone add      --id 2026.02.24-lmb-sales-pipeline --name "MVP" --due 2026-04-01
project milestone complete  --id 2026.02.24-lmb-sales-pipeline --name "MVP"

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

## Per-Project Files

Every project directory contains two seeded files:

**`README.md`** — the project charter. Vault roots include YAML frontmatter; local roots use
plain markdown. H2 sections are standardized so consuming skills can parse by heading.

**`tasks.json`** — the project task list, using the ralph.js schema:

```json
{
  "title": "Sales Pipeline",
  "description": "Automate lead tracking from all sources into a single pipeline",
  "tasks": [
    {
      "id": "task-1",
      "title": "Map existing lead sources",
      "description": "Identify all current lead entry points and document them.",
      "successCriteria": [
        "All lead sources listed",
        "Owner identified for each source"
      ],
      "workerType": "node",
      "status": "completed",
      "output": "Found 4 sources: web form, email, Salesforce import, manual entry.",
      "learnings": "Manual entry accounts for 40% of leads — biggest automation opportunity.",
      "completedAt": "2026-02-25 09:00:00"
    },
    {
      "id": "task-2",
      "title": "Design automation flow",
      "description": "Draft the automated pipeline for each lead source.",
      "successCriteria": ["Flow diagram approved", "Edge cases documented"],
      "workerType": "node",
      "status": "pending",
      "output": "",
      "learnings": "",
      "completedAt": null
    }
  ]
}
```

`project tasks --json` passes the file content through to stdout unchanged.
`project tasks` (no flag) prints a human-readable summary grouped by status.

## Obsidian Frontmatter

Vault projects are seeded with YAML frontmatter for Obsidian Dataview:

```markdown
---
title: "Sales Pipeline"
id: 2026.02.24-lmb-sales-pipeline
status: active
tags:
  - project
location: lmb
started: 2026-02-24
due: 2026-06-30
completed:
archived:
description: "Automate lead tracking"
milestones:
  - name: MVP
    due: 2026-04-01
    completedDate:
---
```

Running `project complete` or `project archive` will update both the index and the
frontmatter in the vault file, keeping them in sync. Local workspace projects remain
plain markdown with no frontmatter.

## Environment Variables

| Variable                          | Source              | Description                              |
|-----------------------------------|---------------------|------------------------------------------|
| `HAL_PROJ_MGR_MASTER_WORKSPACE`   | `hal-env-init.sh`   | Path to master workspace (config + index)|

Or pass `--workspace <path>` to any command.

`HAL_PROJ_MGR_MASTER_WORKSPACE` is generated at container startup from
`/data/openclaw/config/system-config.json` by `hal-env-init.sh`. Running
`project-mgmt init` writes the workspace path into that file automatically.
