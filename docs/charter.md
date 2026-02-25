# Project Charter — openclaw-skill-project-manager

## Goals and Success Criteria

| # | Goal                                           | Success Criterion                                                                                                                                                                                                              |
|---|------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Deterministic project IDs                      | Running `project create --name X --date D --root R` on any machine always produces the same ID. Running it twice fails with "already exists" — not two slightly different IDs. The ID formula is documented and never changes. |
| 2 | Unified index across workspace and vault roots | `project list` shows all projects from all roots in one command. No per-root index files exist. Any agent that knows the workspace path can read the complete project history by reading one file at a known, fixed path.      |
| 3 | Obsidian-compatible vault projects             | Every vault project's README.md contains YAML frontmatter with `title`, `id`, `status`, `tags`, `location`, `started`, `due`, `completed`, `archived`, and `milestones` fields. Running `project complete` or `project archive` updates those fields automatically. A Dataview `TABLE status, started, due WHERE contains(tags, "project")` query returns all vault projects without any additional configuration. |
| 4 | Deadline and milestone tracking                | Every project requires a `--due` date at creation; omitting it exits with an error. Milestones can be added and marked complete independently of the project status. `project show` displays all milestones with their due dates and completion state. |
| 5 | Installable as a public OpenClaw skill         | `npm install -g openclaw-skill-project-manager` on a clean Node >=18 machine installs both `project` and `project-mgmt` binaries with no errors. `npm audit` reports zero vulnerabilities. `SKILL.md` is a valid OpenClaw descriptor. |
| 6 | Zero runtime dependencies                      | `package.json` lists no `dependencies`. All tests pass on Node 18, 20, and 22 on macOS, Linux, and Windows with no additional setup beyond `npm install -g`.                                                                  |

---

## Definition of Done — v1.0

The project is complete when every item below is checked:

**Commands**
- [x] `project create --name X --root R --due YYYY-MM-DD --goals "..."` implemented; omitting `--due` or `--goals` exits 1
- [x] `project create` seeds `README.md` and `tasks.json` with `goals` as the top-level `description`
- [x] `project task add --id <id> --title "..." --description "..." --worker-type <type> [--criteria "..."]` implemented; auto-assigns next task ID
- [x] `project list` and `project list --json` implemented
- [x] `project show` implemented
- [x] `project tasks --id <id>` and `project tasks --id <id> --json` implemented
- [x] `project complete` and `project archive` implemented
- [x] `project milestone add --id <id> --name <name> --due YYYY-MM-DD` implemented
- [x] `project milestone complete --id <id> --name <name>` implemented
- [x] `project-mgmt init` and `project-mgmt roots` implemented

**Data**
- [x] Index entries include `dueDate` and `milestones` array (`[{ name, due, completedDate }]`)
- [x] Vault project frontmatter includes `due` and `milestones` fields
- [x] `project complete` and `project archive` update frontmatter in sync with the index
- [x] `project list --json` output is stable and documented (fields do not change between patch versions)
- [x] `project tasks --id <id> --json` passes `tasks.json` content through to stdout unchanged; consuming skills can rely on the schema
- [x] `project task add` writes a well-formed task object (including `workerType`) and auto-increments the task ID

**Quality**
- [x] All commands have full test coverage including validation error paths
- [ ] All tests pass on Node 18, 20, and 22 on macOS, Linux, and Windows
- [x] `package.json` has zero `dependencies` and `npm audit` reports zero vulnerabilities

**Release**
- [ ] Package published to npm; both binaries install and run on a clean machine
- [x] `SKILL.md` is a valid OpenClaw descriptor recognized by the OpenClaw registry

---

## Scope

### In Scope
- CLI commands: `project create`, `list`, `list --json`, `show`, `tasks`, `task add`, `complete`, `archive`
- Milestone commands: `project milestone add`, `project milestone complete`
- Management commands: `project-mgmt init`, `roots`
- Required `--due` date and required `--goals` text on every project at creation
- `--goals` populates `tasks.json` top-level `description` so the file is meaningful from day one
- Optional named milestones per project, each with a due date and independent completion state
- `tasks.json` seeded in every new project directory (ralph.js schema); `project task add` writes to it; `project tasks` reads it
- Each task carries a `workerType` field telling ralph.js which Claude Code worker should execute it (e.g. `node`, `testing`, `architecture`); intentionally distinct from OpenClaw agent names
- Config per workspace (`project-manager.json`)
- Shared index (`projects-index.json`)
- Obsidian YAML frontmatter seeded at project creation for vault roots, kept in sync on status change
- `SKILL.md` descriptor for OpenClaw installation

### Out of Scope
- GUI or web interface
- Cloud sync or shared indexes across machines
- Project templates beyond the seeded README / frontmatter
- Integration with specific task managers (Linear, Jira, etc.)

---

## Architecture

```
bin/
  project.js        Entry point — create, list, show, tasks, complete, archive, milestone
  project-mgmt.js   Entry point — init, roots
lib/
  config.js         Workspace resolution, shared arg parser, config/index I/O, ID building
  setup.js          Interactive init wizard
  frontmatter.js    Build and sync Obsidian YAML frontmatter (index is source of truth; no YAML parsing)
  commands/
    create.js       Create project dir, seed README.md + tasks.json, write index entry
    list.js         List and filter projects; --json emits raw JSON array
    show.js         Display full details and milestones for a single project
    tasks.js        Read and display tasks.json (project tasks); --json passthrough
    task.js         Write subcommands: task add (appends to tasks.json with workerType field)
    status.js       Transition project status (complete / archive) + sync frontmatter
    milestone.js    Add milestones and mark them complete
    roots.js        Display configured roots
```

**Per-project files** (inside every `{project-dir}/`):

| File         | Format                                                          | Notes                          |
|--------------|-----------------------------------------------------------------|--------------------------------|
| `README.md`  | YAML frontmatter + markdown (vault) or plain markdown (local)  | Charter; queryable by Dataview |
| `tasks.json` | ralph.js schema — `{ title, description, tasks[] }` where each task has `id`, `title`, `description`, `successCriteria[]`, `workerType`, `status`, `output`, `learnings`, `completedAt` | Seeded on `project create`; `description` populated from `--goals`; tasks added via `project task add` |

**Config:** `{workspace}/config/project-manager.json`
**Index:** `{workspace}/projects/projects-index.json`
**Project ID:** `yyyy.mm.dd-{location}-{slug}` (vault) / `yyyy.mm.dd-{slug}` (local)

---

## Constraints

- Node >=18, zero runtime dependencies
- Must work on macOS, Linux, and Windows
- Index must be human-readable JSON (not a database)
- Commands must be safe to run by agents without interactive prompts (except `init`)

---

## Integration Contract

Answers to the questions any consuming skill (e.g. `plan-day`) needs before it can read project data.

| Question                        | Decision                                                                                                    |
|---------------------------------|-------------------------------------------------------------------------------------------------------------|
| Task file format                | `tasks.json` using the ralph.js schema: `{ title, description, tasks[] }`. Each task: `id`, `title`, `description`, `successCriteria[]`, `workerType`, `status`, `output`, `learnings`, `completedAt`. `workerType` tells ralph.js which Claude Code worker to use (e.g. `node`, `testing`, `architecture`). Not an OpenClaw agent name. |
| Task file location              | `{project-dir}/tasks.json` — seeded on `project create` with `description` set from `--goals`; tasks appended via `project task add` |
| Goals / project description     | `project create --goals "..."` is required. The goals string becomes `tasks.json`'s top-level `description` field and is also written to `README.md`. |
| Project charter format          | Each project's `README.md` is its charter. Vault roots: YAML frontmatter + markdown H2 sections. Local roots: plain markdown H2 sections. Section structure is standardized across all projects. |
| Machine-readable output         | `project list --json` emits the projects array as JSON. `project tasks --id <id>` reads `tasks.json` and displays tasks; `--json` passes the file content through to stdout unchanged. |
| Task status values              | Free-form string field; well-known values are `pending`, `in-progress`, `completed`, `cancelled`. Matches ralph.js convention. |

---

## Ideas

Ideas are parked here until dismissed or promoted to [`.tasks/tasks.json`](../.tasks/tasks.json).

| Idea                                            | Notes                                                                                          |
|-------------------------------------------------|------------------------------------------------------------------------------------------------|
| `project delete` command                        | Remove a project from the index; optionally delete the directory                               |
| `project rename` command                        | Rename a project, update the slug in the ID, and move the directory                            |
| Store template paths in index (not absolute)    | Index currently stores resolved absolute paths; relative/template paths would survive moves    |
| Move `process.exit()` out of library functions  | `config.js` calls `process.exit()` directly; library functions should throw, only `bin/` exits |
| Switch to `node:test` for the test suite        | Node 18+ ships a built-in test runner that would eliminate all the manual console/process mocking |
| Multi-workspace / shared index                  | Allow multiple agents or machines to share a single index file                                  |

---

## Stakeholders

| Role           | Who                                              |
|----------------|--------------------------------------------------|
| Owner / Author | jamaynor                                         |
| Users          | OpenClaw agents and the humans who operate them  |
