# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `project create` now requires `--due YYYY-MM-DD` (exits 1 if omitted or invalid)
- `project create` now requires `--goals "..."` (exits 1 if omitted); goals become the top-level `description` in `tasks.json`
- `tasks.json` seeded in every new project directory using the ralph.js schema (`{ title, description, tasks[] }`)
- `project show --id <id>` — display full project details including all dates and milestones
- `project tasks --id <id>` — human-readable task list grouped by status
- `project tasks --id <id> --json` — pass `tasks.json` content through to stdout unchanged
- `project task add` — append a new task to `tasks.json` with auto-incremented ID; required flags: `--id`, `--title`, `--description`, `--worker-type`; repeatable: `--criteria`
- `project milestone add --id <id> --name <name> --due YYYY-MM-DD` — add a named milestone
- `project milestone complete --id <id> --name <name>` — mark a milestone complete
- `project list --json` — emit filtered projects array as JSON
- Obsidian-compatible YAML frontmatter seeded in vault project `README.md` at creation
- Frontmatter kept in sync on `project complete`, `project archive`, and `project milestone complete`
- `dueDate` and `milestones` fields added to index entries
- GitHub Actions workflow: tests on Node 18, 20, 22; publishes on version tags (`v*.*.*`)

### Changed
- `parseArgs` now captures boolean flags (`--json` → `true`) and accumulates repeated flags (`--criteria`) into arrays
- `bin/project.js` updated with full USAGE including all new commands

## [1.0.0] — Initial release (planned)

- `project create`, `list`, `complete`, `archive`
- `project-mgmt init`, `roots`
- Shared index at `{workspace}/projects/projects-index.json`
- Config at `{workspace}/config/project-manager.json`
- Zero runtime dependencies; Node >=18
