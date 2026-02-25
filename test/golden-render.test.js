const test = require("node:test");
const assert = require("node:assert/strict");
const { ADAPTERS, createDefaultRules } = require("../src/index.js");

function getAdapter(id) {
  const adapter = ADAPTERS.find((item) => item.id === id);
  assert.ok(adapter, `Missing adapter: ${id}`);
  return adapter;
}

function defaultRules() {
  return createDefaultRules({
    lint: "echo lint",
    test: "echo test",
    build: "echo build",
  });
}

test("golden render: claude", () => {
  const rendered = getAdapter("claude").render(defaultRules()).trimEnd();
  const expected = [
    "# CLAUDE.md",
    "",
    "## Mission",
    "Ship safe changes quickly while keeping agent instructions consistent.",
    "",
    "## Workflow",
    "- Read relevant files before editing.",
    "- Make the smallest correct change.",
    "- Run verification commands before finalizing.",
    "",
    "## Commands",
    "- lint: `npm run lint`",
    "- test: `npm run test`",
    "- build: `npm run build`",
    "",
    "## Done",
    "- Commands pass or blockers are documented.",
    "- Changed behavior is reflected in docs where needed.",
    "",
    "## Approvals",
    "- Mode: `ask-before-destructive`",
    "- Ask before destructive actions or privileged operations.",
  ].join("\n");

  assert.equal(rendered, expected);
});

test("golden render: codex managed block", () => {
  const rendered = getAdapter("codex").render(defaultRules()).trimEnd();
  const expected = [
    "## rules-doctor Managed Rules",
    "Generated from `.agentrules/rules.yaml`. Edit that file, then run `rules-doctor sync`.",
    "",
    "### Mission",
    "Ship safe changes quickly while keeping agent instructions consistent.",
    "",
    "### Workflow",
    "- Read relevant files before editing.",
    "- Make the smallest correct change.",
    "- Run verification commands before finalizing.",
    "",
    "### Commands",
    "- lint: `npm run lint`",
    "- test: `npm run test`",
    "- build: `npm run build`",
    "",
    "### Done",
    "- Commands pass or blockers are documented.",
    "- Changed behavior is reflected in docs where needed.",
    "",
    "### Approvals",
    "- Policy: `ask-before-destructive`",
    "- Ask before destructive actions or privileged operations.",
  ].join("\n");

  assert.equal(rendered, expected);
});

test("golden render: copilot", () => {
  const rendered = getAdapter("copilot").render(defaultRules()).trimEnd();
  const expected = [
    "# Copilot Instructions",
    "",
    "## rules-doctor Managed Rules",
    "Generated from `.agentrules/rules.yaml`. Edit that file, then run `rules-doctor sync`.",
    "",
    "### Mission",
    "Ship safe changes quickly while keeping agent instructions consistent.",
    "",
    "### Workflow",
    "- Read relevant files before editing.",
    "- Make the smallest correct change.",
    "- Run verification commands before finalizing.",
    "",
    "### Commands",
    "- lint: `npm run lint`",
    "- test: `npm run test`",
    "- build: `npm run build`",
    "",
    "### Done",
    "- Commands pass or blockers are documented.",
    "- Changed behavior is reflected in docs where needed.",
    "",
    "### Approvals",
    "- Policy: `ask-before-destructive`",
    "- Ask before destructive actions or privileged operations.",
  ].join("\n");

  assert.equal(rendered, expected);
});
