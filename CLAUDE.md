# CLAUDE.md — openclaw-skill-project-manager

## Project Overview

OpenClaw skill for **deterministic project creation and tracking** across agent workspaces and Obsidian vaults. Zero runtime dependencies. Node >= 18.

## Binaries

| Binary         | Purpose                                    |
|----------------|--------------------------------------------|
| `project`      | User commands: create, list, show, tasks, task add, milestone, complete, archive |
| `project-mgmt` | System setup: init, roots                  |

## Architecture

| Path                      | Role                                                          |
|---------------------------|---------------------------------------------------------------|
| `bin/project.js`          | CLI entry — try/catch wrapper, routes subcommands             |
| `bin/project-mgmt.js`     | CLI entry — async main(); init + roots                        |
| `lib/config.js`           | resolveWorkspace, parseArgs, parseLocalDate, loadConfig, loadIndex, saveIndex, buildProjectId, formatDate, slugify, resolveRoot, expandPath |
| `lib/frontmatter.js`      | buildFrontmatter, extractBody, setFrontmatter (index is source of truth; no YAML parsing) |
| `lib/setup.js`            | Interactive init wizard (async)                               |
| `lib/commands/create.js`  | --due and --goals required; seeds README.md + tasks.json      |
| `lib/commands/list.js`    | --status filter, --root filter, --json flag                   |
| `lib/commands/status.js`  | complete / archive; syncs vault frontmatter                   |
| `lib/commands/show.js`    | Display all project fields + milestones                       |
| `lib/commands/tasks.js`   | Read tasks.json; --json passthrough                           |
| `lib/commands/task.js`    | task add; auto-increments task-N id                           |
| `lib/commands/milestone.js` | add / complete; syncs vault frontmatter                     |
| `lib/commands/roots.js`   | Display configured roots                                      |

## Key Conventions

- **Zero runtime dependencies** — no minimist, no js-yaml, no yaml
- `lib/` functions throw `Error`; only `bin/` files call `process.exit`
- `parseLocalDate` lives in `lib/config.js` — throws `Error` on invalid input
- Project ID format: `yyyy.mm.dd-{location}-{slug}` (vault) or `yyyy.mm.dd-{slug}` (local)

## Important Paths

| Path                                          | Contents                    |
|-----------------------------------------------|-----------------------------|
| `{workspace}/config/project-manager.json`     | Skill configuration         |
| `{workspace}/projects/projects-index.json`    | Project index (source of truth) |
| `{projDir}/README.md`                         | Project charter             |
| `{projDir}/tasks.json`                        | Task list (ralph.js schema) |

## Testing

```bash
node --test test/test.js
```

- Runner: `node:test` (built-in, Node 18+)
- 146 tests, 20 describe blocks
- `assert.throws(fn, /pattern/)` for error-path assertions
- `silent(fn)` suppresses console output; `captureLog(fn)` captures console.log lines
- `makeWorkspaceWithConfig()` creates a tmp workspace + config for integration tests

## tasks.json Schema (ralph.js)

```json
{ "title": "...", "description": "...", "tasks": [
  { "id": "task-1", "title": "...", "description": "...",
    "successCriteria": [], "workerType": "node",
    "status": "pending", "output": "", "learnings": "", "completedAt": null }
]}
```

`workerType` is a Claude Code worker expertise hint (e.g. `node`, `testing`) — NOT an OpenClaw agent name.
