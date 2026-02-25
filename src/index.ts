#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const RULES_FILE = resolve(".agentrules/rules.yaml");
const CLAUDE_FILE = resolve("CLAUDE.md");
const AGENTS_FILE = resolve("AGENTS.md");
const MARKER_BEGIN = "<!-- RULES_DOCTOR:BEGIN -->";
const MARKER_END = "<!-- RULES_DOCTOR:END -->";

function usage() {
  return [
    "rules-doctor",
    "",
    "Usage:",
    "  rules-doctor init",
    "  rules-doctor sync [--target all|claude|codex]",
    "  rules-doctor analyze",
  ].join("\n");
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseScalar(value) {
  const cleaned = stripQuotes(value);
  if (/^-?\d+$/.test(cleaned)) {
    return Number(cleaned);
  }
  return cleaned;
}

function parseRulesText(text) {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    // YAML fallback for this project's expected shape.
  }

  const data = {};
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let section = null;
  let nested = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      nested = null;
      const top = line.match(/^([a-zA-Z0-9_-]+):(.*)$/);
      if (!top) {
        continue;
      }

      const key = top[1];
      const value = top[2].trim();
      if (!value) {
        section = key;
        if (key === "workflow" || key === "done") {
          data[key] = [];
        } else if (key === "commands" || key === "approvals") {
          data[key] = {};
        }
      } else {
        section = null;
        data[key] = parseScalar(value);
      }
      continue;
    }

    if ((section === "workflow" || section === "done") && line.startsWith("- ")) {
      data[section].push(parseScalar(line.slice(2)));
      continue;
    }

    if (section === "commands") {
      const pair = line.match(/^([a-zA-Z0-9_-]+):(.*)$/);
      if (pair) {
        data.commands[pair[1]] = parseScalar(pair[2].trim());
      }
      continue;
    }

    if (section === "approvals") {
      if (line.startsWith("mode:")) {
        data.approvals.mode = parseScalar(line.slice("mode:".length).trim());
        continue;
      }

      if (line === "notes:") {
        nested = "notes";
        if (!Array.isArray(data.approvals.notes)) {
          data.approvals.notes = [];
        }
        continue;
      }

      if (nested === "notes" && line.startsWith("- ")) {
        data.approvals.notes.push(parseScalar(line.slice(2)));
      }
    }
  }

  return data;
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function stringifyRules(rules) {
  const lines = [
    `version: ${Number.isFinite(rules.version) ? rules.version : 1}`,
    `mission: ${quoteYaml(rules.mission)}`,
    "workflow:",
    ...rules.workflow.map((step) => `  - ${quoteYaml(step)}`),
    "commands:",
    ...Object.keys(rules.commands).map(
      (name) => `  ${name}: ${quoteYaml(rules.commands[name])}`,
    ),
    "done:",
    ...rules.done.map((item) => `  - ${quoteYaml(item)}`),
    "approvals:",
    `  mode: ${quoteYaml(rules.approvals.mode)}`,
    "  notes:",
    ...rules.approvals.notes.map((note) => `    - ${quoteYaml(note)}`),
    "",
  ];

  return lines.join("\n");
}

function inferCommandFromScripts(scripts, scriptName) {
  if (scripts && typeof scripts[scriptName] === "string") {
    return `npm run ${scriptName}`;
  }
  return `echo "TODO: define ${scriptName} command"`;
}

function createDefaultRules() {
  const pkg = readJsonFile(resolve("package.json"));
  const scripts = pkg && typeof pkg === "object" ? pkg.scripts : undefined;

  return {
    version: 1,
    mission: "Ship safe changes quickly while keeping agent instructions consistent.",
    workflow: [
      "Read relevant files before editing.",
      "Make the smallest correct change.",
      "Run verification commands before finalizing.",
    ],
    commands: {
      lint: inferCommandFromScripts(scripts, "lint"),
      test: inferCommandFromScripts(scripts, "test"),
      build: inferCommandFromScripts(scripts, "build"),
    },
    done: [
      "Commands pass or blockers are documented.",
      "Changed behavior is reflected in docs where needed.",
    ],
    approvals: {
      mode: "ask-before-destructive",
      notes: ["Ask before destructive actions or privileged operations."],
    },
  };
}

function normalizeRules(input) {
  const source = input && typeof input === "object" ? input : {};
  const commands = source.commands && typeof source.commands === "object" ? source.commands : {};
  const approvals =
    source.approvals && typeof source.approvals === "object" ? source.approvals : {};

  const workflow = Array.isArray(source.workflow)
    ? source.workflow.filter((item) => typeof item === "string")
    : ["Define your workflow steps."];

  const done = Array.isArray(source.done)
    ? source.done.filter((item) => typeof item === "string")
    : ["Define done criteria."];

  const notes = Array.isArray(approvals.notes)
    ? approvals.notes.filter((item) => typeof item === "string")
    : [];

  return {
    version: typeof source.version === "number" ? source.version : 1,
    mission:
      typeof source.mission === "string" && source.mission.trim()
        ? source.mission
        : "Define your project mission.",
    workflow,
    commands: {
      lint:
        typeof commands.lint === "string"
          ? commands.lint
          : 'echo "TODO: define lint command"',
      test:
        typeof commands.test === "string"
          ? commands.test
          : 'echo "TODO: define test command"',
      build:
        typeof commands.build === "string"
          ? commands.build
          : 'echo "TODO: define build command"',
    },
    done,
    approvals: {
      mode:
        typeof approvals.mode === "string" ? approvals.mode : "ask-before-destructive",
      notes,
    },
  };
}

function readRulesOrThrow() {
  if (!existsSync(RULES_FILE)) {
    throw new Error(`Missing ${RULES_FILE}. Run "rules-doctor init" to create it first.`);
  }

  const raw = readFileSync(RULES_FILE, "utf8");
  return normalizeRules(parseRulesText(raw));
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- (none)";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function formatCommands(commands) {
  if (!commands || typeof commands !== "object") {
    return "- (none)";
  }

  const preferredOrder = ["lint", "test", "build"];
  const names = [
    ...preferredOrder.filter((name) => Object.prototype.hasOwnProperty.call(commands, name)),
    ...Object.keys(commands).filter((name) => !preferredOrder.includes(name)),
  ];

  if (names.length === 0) {
    return "- (none)";
  }

  return names.map((name) => `- ${name}: \`${commands[name]}\``).join("\n");
}

function renderClaude(rules) {
  return [
    "# CLAUDE.md",
    "",
    "## Mission",
    rules.mission,
    "",
    "## Workflow",
    formatList(rules.workflow),
    "",
    "## Commands",
    formatCommands(rules.commands),
    "",
    "## Done",
    formatList(rules.done),
    "",
    "## Approvals",
    `- Mode: \`${rules.approvals.mode}\``,
    ...rules.approvals.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

function renderCodexManagedSection(rules) {
  return [
    "## rules-doctor Managed Rules",
    "Generated from `.agentrules/rules.yaml`. Edit that file, then run `rules-doctor sync`.",
    "",
    "### Mission",
    rules.mission,
    "",
    "### Operational Loop",
    "1. Read relevant context and constraints before editing.",
    "2. Select and run the smallest command that moves the task forward.",
    "3. Apply focused changes.",
    "4. Run verification commands and report exact outcomes.",
    "",
    "### Commands",
    formatCommands(rules.commands),
    "",
    "### Failure Loop",
    "1. Capture the exact failing command and error output.",
    "2. Form one concrete hypothesis for the failure.",
    "3. Apply one fix and rerun the same command.",
    "4. Repeat until green or blocked, then report blocker and next action.",
    "",
    "### Done",
    formatList(rules.done),
    "",
    "### Approvals",
    `- Policy: \`${rules.approvals.mode}\``,
    ...rules.approvals.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

function upsertManagedSection(existing, content) {
  const start = existing.indexOf(MARKER_BEGIN);
  const end = start >= 0 ? existing.indexOf(MARKER_END, start) : -1;

  if (start >= 0 && end > start) {
    const before = existing.slice(0, start + MARKER_BEGIN.length);
    const after = existing.slice(end);
    return `${before}\n${content.trim()}\n${after}`.replace(/\n{3,}/g, "\n\n");
  }

  const base = existing.trimEnd();
  const prefix = base ? `${base}\n\n` : "";
  return `${prefix}${MARKER_BEGIN}\n${content.trim()}\n${MARKER_END}\n`;
}

function initCommand() {
  if (existsSync(RULES_FILE)) {
    console.log(`rules.yaml already exists: ${RULES_FILE}`);
    return;
  }

  mkdirSync(resolve(".agentrules"), { recursive: true });
  writeFileSync(RULES_FILE, stringifyRules(createDefaultRules()), "utf8");
  console.log(`Created ${RULES_FILE}`);
}

function syncCommand(target) {
  const rules = readRulesOrThrow();

  if (target === "all" || target === "claude") {
    writeFileSync(CLAUDE_FILE, renderClaude(rules), "utf8");
    console.log(`Updated ${CLAUDE_FILE}`);
  }

  if (target === "all" || target === "codex") {
    const existing = existsSync(AGENTS_FILE) ? readFileSync(AGENTS_FILE, "utf8") : "";
    const updated = upsertManagedSection(existing, renderCodexManagedSection(rules));
    writeFileSync(AGENTS_FILE, updated, "utf8");
    console.log(`Updated ${AGENTS_FILE}`);
  }
}

function hasVerifyCommand(text) {
  return /\b(npm run|pnpm|yarn)\s+(lint|test|build)\b/i.test(text);
}

function hasNoApprovalLanguage(text) {
  return /never ask (for )?approval|no approvals|without approval|do not ask for approval/i.test(
    text,
  );
}

function hasAskApprovalLanguage(text) {
  return /ask for approval|request approval|require approval|needs approval/i.test(text);
}

function hasRequireTestsLanguage(text) {
  return /must run tests|always run tests|run tests before done/i.test(text);
}

function hasSkipTestsLanguage(text) {
  return /skip tests|tests optional|do not run tests/i.test(text);
}

function analyzeCommand() {
  const claudeExists = existsSync(CLAUDE_FILE);
  const agentsExists = existsSync(AGENTS_FILE);
  const claude = claudeExists ? readFileSync(CLAUDE_FILE, "utf8") : "";
  const agents = agentsExists ? readFileSync(AGENTS_FILE, "utf8") : "";
  const issues = [];

  if (!claudeExists) {
    issues.push("CLAUDE.md missing.");
  }
  if (!agentsExists) {
    issues.push("AGENTS.md missing.");
  }

  if (agentsExists) {
    const hasBegin = agents.includes(MARKER_BEGIN);
    const hasEnd = agents.includes(MARKER_END);
    if (!hasBegin || !hasEnd) {
      issues.push("AGENTS.md missing rules-doctor markers.");
    }
  }

  if (claudeExists && !hasVerifyCommand(claude)) {
    issues.push("CLAUDE.md appears to be missing verify commands (lint/test/build).");
  }

  if (agentsExists && !hasVerifyCommand(agents)) {
    issues.push("AGENTS.md appears to be missing verify commands (lint/test/build).");
  }

  if (
    (hasNoApprovalLanguage(claude) && hasAskApprovalLanguage(agents)) ||
    (hasAskApprovalLanguage(claude) && hasNoApprovalLanguage(agents))
  ) {
    issues.push("Potential contradiction: approval guidance differs between CLAUDE.md and AGENTS.md.");
  }

  if (
    (hasRequireTestsLanguage(claude) && hasSkipTestsLanguage(agents)) ||
    (hasSkipTestsLanguage(claude) && hasRequireTestsLanguage(agents))
  ) {
    issues.push("Potential contradiction: test guidance differs between CLAUDE.md and AGENTS.md.");
  }

  console.log("rules-doctor analyze");
  console.log(`- CLAUDE.md: ${claudeExists ? "found" : "missing"}`);
  console.log(`- AGENTS.md: ${agentsExists ? "found" : "missing"}`);
  console.log("- Findings:");

  if (issues.length === 0) {
    console.log("- No obvious issues found.");
    return;
  }

  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
}

function parseSyncTarget(args) {
  let target = "all";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      const value = args[index + 1];
      if (value !== "all" && value !== "claude" && value !== "codex") {
        throw new Error('Invalid --target value. Use one of: "all", "claude", "codex".');
      }
      target = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for sync: ${arg}`);
  }

  return target;
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "init") {
    initCommand();
    return;
  }

  if (command === "sync") {
    syncCommand(parseSyncTarget(args));
    return;
  }

  if (command === "analyze") {
    analyzeCommand();
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

