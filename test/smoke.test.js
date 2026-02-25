const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { runCli } = require("../src/index.js");

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

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

test("init + sync --write creates managed files", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  const pkgJson = {
    name: "demo",
    private: true,
    scripts: {
      lint: "echo lint",
      test: "echo test",
      build: "echo build",
    },
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");

  assert.equal(run(["init"], dir).exitCode, 0);
  const sync = run(["sync", "--write"], dir);
  assert.equal(sync.exitCode, 0);

  assert.ok(existsSync(join(dir, ".agentrules", "rules.yaml")));
  assert.ok(existsSync(join(dir, "CLAUDE.md")));
  assert.ok(existsSync(join(dir, "AGENTS.md")));
  assert.ok(existsSync(join(dir, ".github", "copilot-instructions.md")));
  assert.ok(existsSync(join(dir, ".cursor", "rules", "rules-doctor.mdc")));
  assert.ok(existsSync(join(dir, "GEMINI.md")));

  const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /RULES_DOCTOR:BEGIN/);
  assert.match(agents, /RULES_DOCTOR:END/);
});

test("sync defaults to dry-run", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(join(dir, "package.json"), '{"name":"demo","private":true}\n');

  assert.equal(run(["init"], dir).exitCode, 0);
  const dryRun = run(["sync"], dir);
  assert.equal(dryRun.exitCode, 0);
  assert.match(dryRun.stdout, /dry-run/i);
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));
});

test("check returns non-zero when drift exists and zero after sync --write", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);

  const before = run(["check"], dir);
  assert.equal(before.exitCode, 1);
  assert.match(before.stdout, /drift detected/i);

  assert.equal(run(["sync", "--write"], dir).exitCode, 0);

  const after = run(["check"], dir);
  assert.equal(after.exitCode, 0);
  assert.match(after.stdout, /in sync/i);
});

test("init --import reads existing CLAUDE.md commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "CLAUDE.md"),
    [
      "# CLAUDE.md",
      "",
      "## Mission",
      "Keep quality high.",
      "",
      "## Commands",
      "- lint: `pnpm lint`",
      "- test: `pnpm test`",
      "- build: `pnpm build`",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal(run(["init", "--import"], dir).exitCode, 0);
  const rules = readFileSync(join(dir, ".agentrules", "rules.yaml"), "utf8");
  assert.match(rules, /mission: "Keep quality high\."/);
  assert.match(rules, /lint: "pnpm lint"/);
  assert.match(rules, /test: "pnpm test"/);
  assert.match(rules, /build: "pnpm build"/);
  assert.ok(existsSync(join(dir, ".agentrules", "import-report.md")));
});

test("targets list includes representative adapters", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  const result = run(["targets", "list"], dir);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /claude/);
  assert.match(result.stdout, /codex/);
  assert.match(result.stdout, /copilot/);
  assert.match(result.stdout, /cursor/);
  assert.match(result.stdout, /gemini/);
  assert.match(result.stdout, /opencode/);
});

test("copilot sync preserves existing user content with marker-managed block", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  mkdirSync(join(dir, ".github"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "copilot-instructions.md"),
    ["# Team Copilot Notes", "", "- Keep this intro untouched.", ""].join("\n"),
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);
  assert.equal(run(["sync", "--target", "copilot", "--write"], dir).exitCode, 0);

  const content = readFileSync(join(dir, ".github", "copilot-instructions.md"), "utf8");
  assert.match(content, /# Team Copilot Notes/);
  assert.match(content, /Keep this intro untouched\./);
  assert.match(content, /RULES_DOCTOR:COPILOT:BEGIN/);
  assert.match(content, /RULES_DOCTOR:COPILOT:END/);
});

test("copilot sync reuses marker block and preserves surrounding content", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  mkdirSync(join(dir, ".github"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "copilot-instructions.md"),
    [
      "# Team Copilot Notes",
      "",
      "Intro before marker.",
      "",
      "<!-- RULES_DOCTOR:COPILOT:BEGIN -->",
      "old managed block",
      "<!-- RULES_DOCTOR:COPILOT:END -->",
      "",
      "Outro after marker.",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);
  assert.equal(run(["sync", "--target", "copilot", "--write"], dir).exitCode, 0);

  const content = readFileSync(join(dir, ".github", "copilot-instructions.md"), "utf8");
  assert.match(content, /Intro before marker\./);
  assert.match(content, /Outro after marker\./);
  assert.match(content, /rules-doctor Managed Rules/);
  assert.equal(countMatches(content, /RULES_DOCTOR:COPILOT:BEGIN/g), 1);
  assert.equal(countMatches(content, /RULES_DOCTOR:COPILOT:END/g), 1);
});

test("init --preset copilot enables only copilot target", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  assert.equal(run(["init", "--preset", "copilot"], dir).exitCode, 0);

  const rules = readFileSync(join(dir, ".agentrules", "rules.yaml"), "utf8");
  assert.match(rules, /claude:\n\s+enabled: false/);
  assert.match(rules, /codex:\n\s+enabled: false/);
  assert.match(rules, /cursor:\n\s+enabled: false/);
  assert.match(rules, /gemini:\n\s+enabled: false/);
  assert.match(rules, /opencode:\n\s+enabled: false/);
  assert.match(rules, /copilot:\n\s+enabled: true/);

  assert.equal(run(["sync", "--write"], dir).exitCode, 0);
  assert.ok(existsSync(join(dir, ".github", "copilot-instructions.md")));
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));
  assert.ok(!existsSync(join(dir, "AGENTS.md")));
  assert.ok(!existsSync(join(dir, ".cursor", "rules", "rules-doctor.mdc")));
  assert.ok(!existsSync(join(dir, "GEMINI.md")));
});

test("preset apply copilot updates existing rules.yaml", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], dir).exitCode, 0);

  const dryRun = run(["preset", "apply", "copilot"], dir);
  assert.equal(dryRun.exitCode, 0);
  assert.match(dryRun.stdout, /dry-run/i);

  const apply = run(["preset", "apply", "copilot", "--write"], dir);
  assert.equal(apply.exitCode, 0);
  assert.match(apply.stdout, /Updated/);

  const rules = readFileSync(join(dir, ".agentrules", "rules.yaml"), "utf8");
  assert.match(rules, /copilot:\n\s+enabled: true/);
  assert.match(rules, /claude:\n\s+enabled: false/);
  assert.match(rules, /codex:\n\s+enabled: false/);
});

test("sync codex and opencode shares AGENTS.md output once", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  assert.equal(run(["init", "--preset", "core"], dir).exitCode, 0);
  const sync = run(["sync", "--target", "codex,opencode", "--write"], dir);
  assert.equal(sync.exitCode, 0);
  assert.match(sync.stdout, /shares output with/i);

  const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.equal(countMatches(agents, /RULES_DOCTOR:BEGIN/g), 1);
  assert.equal(countMatches(agents, /RULES_DOCTOR:END/g), 1);
});

test("init --import with preset copilot keeps imported mission but limits targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  writeFileSync(
    join(dir, "CLAUDE.md"),
    ["# CLAUDE.md", "", "## Mission", "Imported mission text.", ""].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "demo",
      private: true,
      scripts: { lint: "echo lint", test: "echo test", build: "echo build" },
    }) + "\n",
    "utf8",
  );

  assert.equal(run(["init", "--import", "--preset", "copilot"], dir).exitCode, 0);

  const rules = readFileSync(join(dir, ".agentrules", "rules.yaml"), "utf8");
  assert.match(rules, /mission: "Imported mission text\."/);
  assert.match(rules, /copilot:\n\s+enabled: true/);
  assert.match(rules, /claude:\n\s+enabled: false/);
});

test("running in subdirectory still writes to project root", () => {
  const root = mkdtempSync(join(tmpdir(), "rules-doctor-"));
  const subdir = join(root, "apps", "web");
  mkdirSync(subdir, { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "demo", private: true, scripts: { lint: "echo lint" } }) + "\n",
    "utf8",
  );

  assert.equal(run(["init"], subdir).exitCode, 0);
  assert.equal(run(["sync", "--target", "cursor", "--write"], subdir).exitCode, 0);

  assert.ok(existsSync(join(root, ".agentrules", "rules.yaml")));
  assert.ok(existsSync(join(root, ".cursor", "rules", "rules-doctor.mdc")));
  assert.ok(!existsSync(join(subdir, ".agentrules", "rules.yaml")));
});
