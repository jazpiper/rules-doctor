const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  createDefaultRules,
  normalizeRules,
  parseRulesText,
  runCli,
  stringifyRules,
} = require("../src/index.js");

function run(args, cwd) {
  const out = [];
  const err = [];
  const exitCode = runCli(args, {
    cwd,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return {
    exitCode,
    stdout: out.join("\n"),
    stderr: err.join("\n"),
  };
}

test("parseRulesText handles inline comments and YAML single-quote escapes", () => {
  const parsed = parseRulesText(
    [
      "version: 2 # schema version",
      "mission: 'It''s stable' # human note",
      "",
    ].join("\n"),
  );

  assert.equal(parsed.version, 2);
  assert.equal(parsed.mission, "It's stable");
});

test("parseRulesText supports top-level block scalar mission", () => {
  const parsed = parseRulesText(
    [
      "mission: |",
      "  Ship quickly.",
      "  Keep docs aligned.",
      "",
    ].join("\n"),
  );

  assert.equal(parsed.mission, "Ship quickly.\nKeep docs aligned.");
});

test("parseRulesText supports inline map for commands", () => {
  const parsed = parseRulesText('commands: { lint: "pnpm lint", deploy: "pnpm deploy" }\n');
  assert.equal(parsed.commands.lint, "pnpm lint");
  assert.equal(parsed.commands.deploy, "pnpm deploy");
});

test("custom command keys are preserved through normalizeRules + stringifyRules", () => {
  const parsed = parseRulesText(
    [
      "commands:",
      '  test:e2e: "pnpm test:e2e"',
      '  lint: "pnpm lint"',
      "",
    ].join("\n"),
  );

  assert.equal(parsed.commands["test:e2e"], "pnpm test:e2e");

  const normalized = normalizeRules(parsed, createDefaultRules({}));
  assert.equal(normalized.commands["test:e2e"], "pnpm test:e2e");

  const text = stringifyRules(normalized);
  assert.match(text, /test:e2e: "pnpm test:e2e"/);
});

test("sync respects targets even when targets block is indented with four spaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", private: true, scripts: { lint: "echo lint" } }) + "\n",
    "utf8",
  );
  mkdirSync(join(dir, ".agentrules"), { recursive: true });

  writeFileSync(
    join(dir, ".agentrules", "rules.yaml"),
    [
      "version: 2",
      'mission: "demo"',
      "workflow:",
      '  - "w"',
      "commands:",
      '  lint: "echo lint"',
      "done:",
      '  - "d"',
      "approvals:",
      '  mode: "ask-before-destructive"',
      "  notes:",
      '    - "n"',
      "targets:",
      "    claude:",
      "      enabled: false",
      '      path: "CLAUDE.md"',
      "",
    ].join("\n"),
    "utf8",
  );

  const result = run(["sync", "--target", "claude", "--write"], dir);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /disabled/i);
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));
});

test("inline comments in rules.yaml do not trigger numeric validation errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", private: true, scripts: { lint: "echo lint" } }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);
  const rulesPath = join(dir, ".agentrules", "rules.yaml");
  const current = readFileSync(rulesPath, "utf8");
  writeFileSync(rulesPath, current.replace("version: 2", "version: 2 # inline"), "utf8");

  const sync = run(["sync"], dir);
  assert.equal(sync.exitCode, 0);
  assert.doesNotMatch(sync.stderr, /"version" must be a number/);
});

test("block scalar mission does not emit suspicious-line warnings", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", private: true, scripts: { lint: "echo lint" } }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);
  const rulesPath = join(dir, ".agentrules", "rules.yaml");
  let current = readFileSync(rulesPath, "utf8");
  current = current.replace('mission: "Ship safe changes quickly while keeping agent instructions consistent."', [
    "mission: |",
    "  Ship safe changes quickly.",
    "  Keep instructions consistent.",
  ].join("\n"));
  writeFileSync(rulesPath, current, "utf8");

  const sync = run(["sync"], dir);
  assert.equal(sync.exitCode, 0);
  assert.doesNotMatch(sync.stdout, /Suspicious YAML line/);
});

test("invalid command and target path values are rejected with validation errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", private: true, scripts: { lint: "echo lint" } }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);
  const rulesPath = join(dir, ".agentrules", "rules.yaml");
  let current = readFileSync(rulesPath, "utf8");
  current = current.replace('lint: "npm run lint"', 'lint: ""');
  current = current.replace('path: "CLAUDE.md"', 'path: ""');
  writeFileSync(rulesPath, current, "utf8");

  const check = run(["check"], dir);
  assert.equal(check.exitCode, 1);
  assert.match(check.stderr, /rules\.yaml validation errors:/);
  assert.match(check.stderr, /"commands\.lint" must be a non-empty string/);
  assert.match(check.stderr, /"targets\.claude\.path" must be a non-empty string/);
});
