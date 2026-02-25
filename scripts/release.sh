#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
release.sh — automated git tag + npm publish

Usage:
  bash scripts/release.sh <patch|minor|major|x.y.z> [--dry-run]

Environment:
  NPM_TOKEN_FILE   Path to a file containing an npm automation token (single line).
                  Default: /home/ubuntu/.openclaw/secrets/npm-token

Notes:
- Requires clean git working tree.
- Uses a temporary npm userconfig so the token is not written to ~/.npmrc.
USAGE
}

bump="${1:-}"
shift || true

dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 2 ;;
  esac
  shift
done

if [[ -z "$bump" ]]; then
  usage
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "Error: must run inside a git repository." >&2
  exit 2
fi
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit/stash first." >&2
  git status --porcelain
  exit 2
fi

TOKEN_FILE="${NPM_TOKEN_FILE:-/home/ubuntu/.openclaw/secrets/npm-token}"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Error: NPM token file not found: $TOKEN_FILE" >&2
  exit 2
fi
TOKEN="$(head -n 1 "$TOKEN_FILE" | tr -d '\r' | tr -d '\n')"
if [[ -z "$TOKEN" ]]; then
  echo "Error: NPM token file is empty: $TOKEN_FILE" >&2
  exit 2
fi

echo "== rules-doctor release =="
echo "repo: $ROOT"
echo "bump: $bump"
if [[ $dry_run -eq 1 ]]; then
  echo "mode: DRY RUN"
fi

# Pre-flight
npm test

old_version="$(node -p "require('./package.json').version")"

if [[ $dry_run -eq 1 ]]; then
  # Update package.json only, no tag/commit.
  npm version "$bump" --no-git-tag-version
  new_version="$(node -p "require('./package.json').version")"
  echo "version: $old_version -> $new_version"
  npm test
  echo "(dry-run) would commit + tag v$new_version, push, and publish to npm"
  git checkout -- package.json package-lock.json 2>/dev/null || true
  exit 0
fi

# Version bump (creates commit + tag)
npm version "$bump" -m "chore(release): v%s"
new_version="$(node -p "require('./package.json').version")"
echo "version: $old_version -> $new_version"

# Ensure build/test still good post-bump
npm test

# Push commit + tag
git push --follow-tags

# Publish using temp userconfig (keeps token out of ~/.npmrc)
tmp_npmrc="$(mktemp)"
trap 'rm -f "$tmp_npmrc"' EXIT
printf "//registry.npmjs.org/:_authToken=%s\n" "$TOKEN" > "$tmp_npmrc"

npm publish --access public --userconfig "$tmp_npmrc"

# Verify
published_version="$(npm view @jazpiper/rules-doctor version)"
if [[ "$published_version" != "$new_version" ]]; then
  echo "Warning: npm view reports $published_version, expected $new_version" >&2
else
  echo "published: @jazpiper/rules-doctor@$published_version"
fi
