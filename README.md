# @jazpiper/rules-doctor

`rules-doctor` keeps coding-rule files in sync across multiple agent CLIs from one source of truth: `.agentrules/rules.yaml`.

It is optimized for real project adoption:
- import existing docs (`init --import`)
- safe previews by default (`sync` is dry-run unless `--write`)
- drift detection for CI (`check`)

All paths are resolved from project root (`.git` ancestor), not current subdirectory.
For safety, target output paths must stay inside the project root:
- absolute paths are rejected
- `..` path escape is rejected
- symlink traversal is rejected

## Install

```bash
npm install -D @jazpiper/rules-doctor
```

Run with:

```bash
npx rules-doctor --help
```

## Quick Start

### 1) Initialize (recommended with import)

```bash
npx rules-doctor init --import
```

- Creates `.agentrules/rules.yaml`
- Reads existing docs when found (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`)
- Writes `.agentrules/import-report.md`

### 2) Preview changes safely

```bash
npx rules-doctor sync --diff
```

`sync` is dry-run by default. Nothing is written yet.

### 3) Apply changes

```bash
npx rules-doctor sync --write
```

Optional backups:

```bash
npx rules-doctor sync --write --backup
```

### 4) Verify drift in CI/local

```bash
npx rules-doctor check
```

Returns non-zero when generated targets are out of sync.

## Supported Targets

Built-in adapters:
- `claude` -> `CLAUDE.md` (full-managed)
- `codex` -> `AGENTS.md` (marker-managed)
- `copilot` -> `.github/copilot-instructions.md` (marker-managed, preserves existing text outside managed block)
- `opencode` -> `AGENTS.md` (marker-managed)
- `cursor` -> `.cursor/rules/rules-doctor.mdc` (full-managed)
- `gemini` -> `GEMINI.md` (full-managed)

## Command Reference

### `init`

```bash
npx rules-doctor init [--import]
```

### `sync`

```bash
npx rules-doctor sync [--target all|claude,codex,...] [--diff] [--write] [--backup]
```

### `check`

```bash
npx rules-doctor check [--target all|claude,codex,...] [--diff]
```

## CI Template

Copy [docs/workflows/rules-doctor-check.yml](docs/workflows/rules-doctor-check.yml) to your repository as `.github/workflows/rules-doctor-check.yml`.
It runs `npx rules-doctor check` on push and pull requests.

Inline workflow example:

```yaml
name: Rules Doctor Check

on:
  push:
  pull_request:

jobs:
  rules-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npx rules-doctor check
```

## Troubleshooting

- `rules-doctor: command not found` after `npm install -D @jazpiper/rules-doctor`:
  - Use `npx rules-doctor ...` (recommended for local dev dependency).
  - Or add an npm script in your project: `"rules:check": "rules-doctor check"`, then run `npm run rules:check`.
  - Global install (`npm i -g @jazpiper/rules-doctor`) works, but local + `npx` is safer for version consistency.
- `init` says `rules.yaml already exists`:
  - Edit `.agentrules/rules.yaml` directly, then run `npx rules-doctor sync --write`.
- `sync --write` fails with target path errors:
  - Use project-relative paths only in `.agentrules/rules.yaml` (`targets.<id>.path`).
  - Do not use absolute paths or `..` segments.
  - Do not point managed outputs through symlink paths.

## Rules Schema (v2 Draft)

See [docs/rules-v2-draft.yaml](docs/rules-v2-draft.yaml).

## Development

```bash
npm ci
npm test
```

## License

MIT
