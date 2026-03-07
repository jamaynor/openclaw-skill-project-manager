# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] — 2026-03-07

### Added
- **Project UUID in frontmatter** — `project-uuid: p-{uuid}` field added to `project-index.md` at creation; `migrate` patches legacy projects inline
- **`project show --json`** — emits full live project record (frontmatter + milestones/tasks/blockers) as JSON
- **`project list` task summary** — each row shows task count (e.g. `3/7 tasks done`) derived from global index data
- **Due date warnings on `project list`** — active projects flagged with `[OVERDUE]` or `[DUE SOON]` inline; warning window (`dueSoonDays`, default 7) stored in `hal-project-manager.json`
- **`project-mgmt init` non-interactive mode** — `--project-manager-agent <id>` and `--vaults-root <path>` flags skip the interactive wizard for headless container init
- **`project-mgmt prune`** — removes dated global index files older than a retention window (default 30 days, `--days <n>`); archives to PARA vault before deleting
- **Sweep archiving** — completed/archived projects render as a single summary line in the global index (no milestone/task detail)
- **Blocker tracking** — `project blocker add` and `project blocker resolve`; `## Blockers` section in `project-index.md`; open blockers surfaced in sweep output
- **Task lifecycle commands** — `project task complete`, `project task update`, `project task cancel` with UUID-based lookup and date recording
- **Task description child lines** — descriptions stored as indented `> text` lines beneath task lines in `project-index.md`
- **`project-mgmt migrate`** and **`project-mgmt sweep`** commands
- **email-triage integration test** — `test/integration.test.js` mocking the full email-triage-to-task-add workflow

### Changed
- **ESM migration** — entire codebase converted from CommonJS to ESM (`"type": "module"`); all `require()`/`module.exports` replaced with `import`/`export`
- **Commander CLI** — `bin/project.js` and `bin/project-mgmt.js` rewritten using `commander`; hand-written arg parser removed
- **Pino logger** — `lib/logger.js` replaced with pino-based implementation; same external interface preserved
- **`project-index.md` as single source of truth** — all project data lives in one self-contained markdown file with YAML frontmatter
- **Config filename** — config stored at `{workspace}/config/hal-project-manager.json`
- **`--worker-type` removed** — flag dropped from `project task add` (was stored but never used)
- **`resolveWorkspace` / `resolveAgentWorkspace`** — signatures updated to accept string values instead of raw argv arrays
- **`parseArgs` removed** from `lib/config.js`

### Dependencies
- Added `commander ^12.0.0`
- Added `pino ^9.0.0`
- Node engine requirement raised to `>=22`

## [0.1.0] — Initial release

- `project create`, `list`, `complete`, `archive`
- `project show`, `project tasks`, `project task add`
- `project milestone add`, `project milestone complete`
- `project-mgmt init`, `roots`
- `project list --json`
- Self-contained `project-index.md` with YAML frontmatter
- UUID identity for all entities (projects, milestones, tasks, subtasks, blockers)
- Structured JSON-line logging via `lib/logger.js`
- 221+ tests using Node built-in test runner
