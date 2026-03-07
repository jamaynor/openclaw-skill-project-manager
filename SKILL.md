---
name: project-manager
description: >
  Create and track projects deterministically across agent workspaces and Obsidian
  vaults. Use when creating a new project, listing active projects, inspecting a
  project's details, adding milestones or tasks, marking a project complete or
  archived, or running a portfolio sweep. Every project lives in a single
  self-contained project-index.md file. The Program Manager runs sweep to build
  a dated global index across the entire portfolio.
homepage: https://github.com/jamaynor/openclaw-skill-project-manager
metadata:
  {
    "openclaw":
      {
        "emoji": "🗂️",
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "openclaw-skill-project-manager",
              "bins": ["project", "project-mgmt"],
              "label": "Install project-manager skill (node)"
            }
          ]
      }
  }
---

# project-manager

Create and track projects deterministically. Every project gets a consistent
dated ID, a directory in the right place (vault or local workspace), and a
single `project-index.md` file that holds the full project record — frontmatter,
charter, milestones, tasks, and subtasks.

Two binaries are installed:
- **`project`** — work with individual projects (create, list, show, tasks, task, milestone, complete, archive)
- **`project-mgmt`** — configure and inspect the system (init, roots, sweep, migrate)

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

# Add a milestone (--due is required)
project milestone add --id 2026.02.24-lmb-sales-pipeline --name "MVP" --due 2026-04-01

# Mark a milestone complete
project milestone complete --id 2026.02.24-lmb-sales-pipeline --name "MVP"

# Add a task to a project (--milestone is required — accepts UUID or positional code e.g. M-1)
project task add --id 2026.02.24-lmb-sales-pipeline \
  --milestone M-1 \
  --title "Map existing lead sources" \
  --description "Identify all current lead entry points and document them." \
  --worker-type node

# Read a project's task list
project tasks --id 2026.02.24-lmb-sales-pipeline
project tasks --id 2026.02.24-lmb-sales-pipeline --json

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

# Aggregate all project-index.md files into a dated global index
project-mgmt sweep

# Bulk-migrate old README.md + tasks.md projects to project-index.md format
project-mgmt migrate
```

## Per-Project File: `project-index.md`

Every project directory contains exactly one file: `project-index.md`. It holds
the complete project record — frontmatter, charter, milestones, tasks, and subtasks.

```markdown
---
title: "Sales Pipeline"
id: 2026.02.24-lmb-sales-pipeline
status: active
tags:
  - project
started: 2026-02-24
due: 2026-06-30
completed:
archived:
description: "Automate lead tracking"
path: /vaults/lmb-vault/1-Projects/2026.02.24-lmb-sales-pipeline
last-touched: 2026-02-24
---

# Sales Pipeline

> Automate lead tracking from all sources into a single pipeline
> Lead:
> Due: 2026-06-30

## M-1: Discovery (id:m-{uuid})

- [ ] M1-T1: Map existing lead sources (id:t-{uuid})
  - [ ] M1-T1-S1: All sources listed (id:s-{uuid})
  - [ ] M1-T1-S2: Owner identified for each source (id:s-{uuid})

- [x] M1-T2: Define automation scope (id:t-{uuid}) done:2026-02-25
```

**Entity identity:**
- Every milestone, task, and subtask receives a UUID at creation (`id:m-`, `id:t-`, `id:s-`)
- Positional codes (`M-1`, `M1-T1`, `M1-T1-S1`) are human-readable labels and are recalculated on render
- UUIDs are permanent — they survive reordering and renaming
- `--milestone` on `project task add` accepts either a UUID or a positional code

**Status mapping:**
- `- [ ]` = pending
- `- [x]` = completed (with optional `done:YYYY-MM-DD`)
- `- [-]` = cancelled

## Global Project Index

The portfolio view lives in a dated file at:

```
{workspace}/projects/yyyy.mm.dd-global-project-index.md
```

`project-mgmt sweep` walks all configured roots, reads every `project-index.md`,
and writes a new dated global index. The Program Manager agent owns this file
and runs sweep to keep the portfolio view current. `project list` and `project show`
read the most recent dated global index file for lookups.

`project create` appends the new project to the current global index immediately
on creation.

## email-triage Integration (Optional)

If the `email-triage` skill is installed, the agent can use its structured
output to surface project task candidates directly from email.

**When to use this:** When the user asks something like "any emails I should
turn into tasks?", "create tasks from today's email brief", or "what actions
came in over email?", run `email-triage --json` and filter threads where
`category == "action-required"` and `project_hint` is set.

**Mapping email-triage fields to project tasks:**

| email-triage field  | project task field          | Notes                                                |
| ------------------- | --------------------------- | ---------------------------------------------------- |
| `action`            | `--title`                   | GSD discipline applies — confirm with user first     |
| `summary`           | `--description`             |                                                      |
| `deadline`          | task due date (in title)    | Remind user to set due date on the project task      |
| `project_hint`      | `--id` (project lookup)     | Match against active project names; ask if ambiguous |
| `urgency: critical` | surface first in the list   |                                                      |
| `attachments`       | mention in description      | Note relevant filenames so user has context          |

**Workflow:**

1. Run `email-triage --json` (only if email-triage is installed).
2. Filter `threads` where `category == "action-required"`.
3. For each thread, present the candidate to the user:
   > "I found an action item from Marie Duval: 'Reply to Marie with Q2
   > priorities' (deadline: today, project hint: Q2 strategy). Add this as a
   > task to your Q2 strategy project?"
4. On confirmation, resolve `project_hint` to a project ID using
   `project list --json`, then run `project task add`.
5. If `project_hint` matches no active project, ask the user which project to
   use or whether to create a new one.
6. If `project_hint` is null, ask the user which project the task belongs to
   before adding it.

**Do not bulk-add tasks without confirmation.** Present each candidate
individually and wait for a response before moving to the next.

---

## Environment Variables

| Variable                          | Source              | Description                                   |
|-----------------------------------|---------------------|-----------------------------------------------|
| `HAL_PROJ_MGR_MASTER_WORKSPACE`   | `hal-env-init.sh`   | Path to master workspace (config + index)     |

Or pass `--workspace <path>` to any command.

`HAL_PROJ_MGR_MASTER_WORKSPACE` is generated at container startup from
`/data/openclaw/config/system-config.json` by `hal-env-init.sh`. Running
`project-mgmt init` writes the workspace path into that file automatically.
