# @jazpiper/rules-doctor

`rules-doctor` is a Node.js CLI (TypeScript) that keeps agent instruction files in sync from one source of truth: `.agentrules/rules.yaml`.

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
```

Generates/updates:
- `CLAUDE.md` (fully managed)
- `AGENTS.md` (only content inside markers is managed)

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

Reads `CLAUDE.md` and `AGENTS.md`, then prints a concise report about:
- missing markers
- missing verify commands (`lint`/`test`/`build`)
- obvious contradictions (simple heuristics)

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
