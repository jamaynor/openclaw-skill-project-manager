# openclaw-skill-project-manager

An [OpenClaw](https://openclaw.ai) skill for **deterministic project creation and tracking** across agent workspaces and Obsidian vaults.

---

## Why this exists

When AI agents create projects, they do it inconsistently: directories end up in random locations, names vary between sessions, and there is no shared record of what was created. A project made today can't reliably be found or referenced tomorrow — by the same agent or any other.

This skill gives every project a stable, predictable identity: a dated ID derived from its name, a directory in a location you control, and an entry in a single index file that any agent or tool can read.

---

## What it does

- **Creates projects** with a consistent dated ID (`2026.02.24-lmb-sales-pipeline`), a directory, a README charter, and a `tasks.json` task list — all in one command
- **Tracks projects** in a single index file at a fixed, known path; any agent that knows the workspace path can read it
- **Lists and filters** projects by status or root; outputs JSON for machine consumption
- **Manages tasks** within a project: add tasks with required metadata, view them grouped by status
- **Tracks milestones** with due dates; marks them complete independently of project status
- **Supports Obsidian vaults** — vault projects are seeded with Dataview-compatible YAML frontmatter and kept in sync when status changes
- **Requires a due date** on every project and goals text that seeds the task list description

Two binaries are installed:

- **`project`** — work with projects: `create`, `list`, `show`, `tasks`, `task add`, `milestone`, `complete`, `archive`
- **`project-mgmt`** — configure the system: `init`, `roots`

---

## Quick start

```bash
# 1. One-time setup — configure where projects live
project-mgmt init

# 2. Create a project
project create --name "Sales Pipeline" --root lmb-vault --due 2026-06-30 \
  --goals "Automate lead tracking from all sources into a single pipeline"

# 3. List projects
project list
project list --status active
project list --json          # machine-readable

# 4. Inspect a project
project show --id 2026.02.24-lmb-sales-pipeline

# 5. Add a task
project task add --id 2026.02.24-lmb-sales-pipeline \
  --title "Map existing lead sources" \
  --description "Identify all current lead entry points and document them." \
  --worker-type node \
  --criteria "All lead sources listed" \
  --criteria "Owner identified for each source"

# 6. View tasks
project tasks --id 2026.02.24-lmb-sales-pipeline
project tasks --id 2026.02.24-lmb-sales-pipeline --json

# 7. Add and complete a milestone
project milestone add      --id 2026.02.24-lmb-sales-pipeline --name "MVP" --due 2026-04-01
project milestone complete  --id 2026.02.24-lmb-sales-pipeline --name "MVP"

# 8. Close out a project
project complete --id 2026.02.24-lmb-sales-pipeline
project archive  --id 2026.02.24-lmb-sales-pipeline
```

---

## Project ID format

IDs are derived from the date, an optional location code, and a slugified name:

```
2026.02.24-lmb-sales-pipeline   # vault root with location code "lmb"
2026.02.24-internal-tool         # local workspace root (no location)
```

The same name, date, and root always produce the same ID. Creating a duplicate exits with an error.

---

## Files created per project

| File         | Contents                                                        |
|--------------|-----------------------------------------------------------------|
| `README.md`  | Project charter. Vault roots include Obsidian YAML frontmatter. |
| `tasks.json` | Task list using the ralph.js schema, seeded with your `--goals` as the description. |

---

## Multi-agent use

In a multi-agent setup, one agent owns the shared project index (the "project manager"). Other agents can create projects and have their files land in their own workspace, while the index stays in the PM's workspace.

In a HAL deployment, declare the master workspace in `/data/openclaw/config/system-config.json` and source `hal-env-init.sh` at container startup to export `HAL_PROJ_MGR_MASTER_WORKSPACE`. See [INSTALL.md](INSTALL.md) for the full setup guide.

## Installation

See [INSTALL.md](INSTALL.md).

---

## Project documentation

- [INSTALL.md](INSTALL.md) — installation and first-time setup
- [SKILL.md](SKILL.md) — OpenClaw skill descriptor and full command reference
- [docs/charter.md](docs/charter.md) — goals, architecture, integration contract, and ideas backlog
- [.tasks/tasks.json](.tasks/tasks.json) — development task backlog