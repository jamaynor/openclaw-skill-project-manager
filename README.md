# openclaw-skill-project-manager

An [OpenClaw](https://openclaw.ai) community skill for **deterministic project creation
and tracking** across agent workspaces and Obsidian vaults.

## The Problem

When an AI agent creates projects by reading naming conventions from a document, the
results are non-deterministic — folder names vary, index files get inconsistent entries,
and projects end up in the wrong place. This skill fixes that with a CLI that always
produces the same output given the same inputs.

## What It Does

- Creates project directories with consistent dated IDs (`2026.02.24-lmb-sales-pipeline`)
- Supports **local** (agent workspace) and **vault** (Obsidian) project roots
- Maintains a predictable `projects-index.json` in the agent workspace
- Seeds each new project with a `README.md`
- Interview-style `init` wizard for first-time config

## Two Binaries

| Binary         | Purpose                                    |
|----------------|--------------------------------------------|
| `project`      | Work with projects (create, list, complete, archive) |
| `project-mgmt` | Configure and inspect the system (init, roots)       |

## Installation

```bash
npm install -g openclaw-skill-project-manager
```

Or via clawhub:

```bash
npx clawhub install project-manager
```

## Quick Start

```bash
# 1. Run the setup wizard (once per agent workspace)
project-mgmt init

# 2. Create a project in a vault
project create --name "Sales Pipeline" --root lmb-vault --description "Automate lead tracking"
# → creates: /vaults/lmb-vault/1-Projects/2026.02.24-lmb-sales-pipeline/
# → updates: {workspace}/projects/projects-index.json

# 3. Create a project locally (in agent workspace)
project create --name "Internal Research" --root workspace
# → creates: {workspace}/projects/2026.02.24-internal-research/
# → updates: {workspace}/projects/projects-index.json

# 4. List projects
project list
project list --status active --root lmb-vault

# 5. Update status
project complete --id 2026.02.24-lmb-sales-pipeline
project archive  --id 2026.02.24-lmb-sales-pipeline

# 6. Show configured roots
project-mgmt roots
```

## Project ID Format

```
yyyy.mm.dd-{location}-{slug}    # vault root with location code
yyyy.mm.dd-{slug}               # local workspace root (no location)
```

## Config File

Saved at `{agent-workspace}/config/project-manager.json` by the setup wizard:

```json
{
  "namingConvention": "yyyy.mm.dd-{location}-{slug}",
  "roots": [
    {
      "name": "workspace",
      "type": "local",
      "path": "{agent-workspace}/projects",
      "location": null,
      "description": "Local agent workspace projects"
    },
    {
      "name": "lmb-vault",
      "type": "vault",
      "path": "/vaults/lmb-vault/1-Projects",
      "location": "lmb",
      "description": "Lake Monster Brewing projects"
    },
    {
      "name": "lmb-kc",
      "type": "vault",
      "path": "/vaults/lmb-kc-vault/1-Projects",
      "location": "lmb",
      "description": "Lake Monster / King Coil projects"
    }
  ]
}
```

## Index File

Always at `{agent-workspace}/projects/projects-index.json` — never moves, never configurable.
Co-located with local projects, trivially findable by any agent or script.

## Workspace Resolution

The agent workspace is resolved in this order:

1. `--workspace <path>` flag
2. `PROJECT_AGENT_WORKSPACE` environment variable
3. Current working directory

## License

MIT
