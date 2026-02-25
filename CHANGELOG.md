# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 - 2026-02-25

- Added `copilot` adapter support for `.github/copilot-instructions.md`.
- Switched Copilot output to marker-managed mode to preserve user-authored content.
- Added target presets for `init` (`all`, `core`, `copilot`).
- Added `preset apply` command for applying presets to existing `.agentrules/rules.yaml`.
- Added CI workflow template for drift detection via `rules-doctor check`.
- Expanded tests for shared `AGENTS.md`, Copilot marker re-sync, and `--import` + preset behavior.
- Improved README with troubleshooting and CI examples.

## 0.2.0 - 2026-02-25

- Added multi-target adapters for `claude`, `codex`, `cursor`, `gemini`, and `opencode`.
- Added `init --import`, dry-run default for `sync`, drift `check`, and structural `doctor`.
