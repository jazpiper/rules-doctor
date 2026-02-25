# @jazpiper/rules-doctor

`rules-doctor` is a Node.js CLI that keeps agent instruction files in sync from one source of truth: `.agentrules/rules.yaml`.

It is designed for multi-agent workflows where each coding CLI reads a different file format.

By default, commands resolve paths relative to the project root (`.git` ancestor), not the current subdirectory.

## Install

```bash
npm install -D @jazpiper/rules-doctor
```

Or run directly:

```bash
npx @jazpiper/rules-doctor init
```

## Usage

### 1) Initialize rules

```bash
rules-doctor init
```

Creates `.agentrules/rules.yaml` if it does not exist.

- If `package.json` has scripts for `lint`, `test`, or `build`, they are inferred as:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Missing scripts are created as TODO placeholders.

### 2) Sync generated docs

```bash
rules-doctor sync
rules-doctor sync --target claude
rules-doctor sync --target codex
rules-doctor sync --target cursor,gemini,opencode,antigravity
```

Generates/updates:
- `CLAUDE.md` (`claude`, fully managed)
- `AGENTS.md` (`codex`, `opencode`, marker-managed)
- `.cursor/rules/rules-doctor.mdc` (`cursor`, fully managed)
- `GEMINI.md` (`gemini`, fully managed)
- `GEMINI.md` (`antigravity`, inferred-compatible mapping)

Managed marker block in `AGENTS.md`:

```md
<!-- RULES_DOCTOR:BEGIN -->
... managed content ...
<!-- RULES_DOCTOR:END -->
```

If markers are missing, a new managed block is appended to the end of `AGENTS.md`.

### 3) Analyze docs

```bash
rules-doctor analyze
```

Reads enabled target files from `rules.yaml`, then prints a concise report about:
- missing markers
- missing verify commands (`lint`/`test`/`build`)
- obvious contradictions (simple heuristics across generated targets)

`--strict` makes `analyze` fail with non-zero exit code when findings exist.

### 4) List supported adapters

```bash
rules-doctor targets list
```

Shows built-in adapters and default file paths.

### 5) Directory/Path Notes

- `claude`: searches `CLAUDE.md` from current directory upward; also supports `.claude/CLAUDE.md` and `.claude/rules/*.md`.
- `codex`: looks for `AGENTS.override.md` or `AGENTS.md` from project root down to current directory.
- `opencode`: reads project `AGENTS.md`, plus user global `~/.config/opencode/AGENTS.md`.
- `cursor`: project rules live in `.cursor/rules/*.mdc` (legacy `.cursorrules` still exists).
- `gemini`: uses `GEMINI.md` in workspace/ancestor directories and `~/.gemini/GEMINI.md`.
- `antigravity`: currently mapped to `GEMINI.md` as an inferred default; verify in your environment.

## Rules Schema (v2 Draft)

`init` now creates a v2-compatible draft with `targets` configuration:

```yaml
version: 2
mission: "Ship safe changes quickly while keeping agent instructions consistent."
workflow:
  - "Read relevant files before editing."
  - "Make the smallest correct change."
  - "Run verification commands before finalizing."
commands:
  lint: "npm run lint"
  test: "npm run test"
  build: "npm run build"
done:
  - "Commands pass or blockers are documented."
  - "Changed behavior is reflected in docs where needed."
approvals:
  mode: "ask-before-destructive"
  notes:
    - "Ask before destructive actions or privileged operations."
targets:
  claude:
    enabled: true
    path: "CLAUDE.md"
  codex:
    enabled: true
    path: "AGENTS.md"
  cursor:
    enabled: true
    path: ".cursor/rules/rules-doctor.mdc"
  gemini:
    enabled: true
    path: "GEMINI.md"
  opencode:
    enabled: true
    path: "AGENTS.md"
  antigravity:
    enabled: true
    path: "GEMINI.md"
```

You can disable or relocate any target by editing `targets.<id>.enabled/path`.

## Development

```bash
npm ci
npm run build
```

## License

MIT


## CI

This repo includes a GitHub Actions workflow template at `docs/workflows/ci.yml`.

If you want CI, copy it to `.github/workflows/ci.yml` and push the change.
