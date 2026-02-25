#!/usr/bin/env node
const { dirname, isAbsolute, resolve } = require("node:path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { ADAPTERS, ADAPTERS_BY_ID } = require("./adapters");

const RULES_RELATIVE_PATH = ".agentrules/rules.yaml";

function usage() {
  const targets = ADAPTERS.map((adapter) => adapter.id).join("|");
  return [
    "rules-doctor",
    "",
    "Usage:",
    "  rules-doctor init",
    `  rules-doctor sync [--target all|${targets}|<comma-separated-targets>]`,
    "  rules-doctor analyze",
    "  rules-doctor targets list",
  ].join("\n");
}

function createLogger(options) {
  return {
    log:
      options && typeof options.stdout === "function"
        ? options.stdout
        : (message) => console.log(message),
    error:
      options && typeof options.stderr === "function"
        ? options.stderr
        : (message) => console.error(message),
  };
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
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
  if (/^(true|false)$/i.test(cleaned)) {
    return cleaned.toLowerCase() === "true";
  }
  if (cleaned === "null" || cleaned === "~") {
    return null;
  }
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
  let currentTarget = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      nested = null;
      currentTarget = null;

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
        } else if (key === "commands" || key === "approvals" || key === "targets") {
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
      continue;
    }

    if (section === "targets") {
      if (indent === 2) {
        const target = line.match(/^([a-zA-Z0-9_-]+):(.*)$/);
        if (!target) {
          continue;
        }

        currentTarget = target[1];
        const maybeValue = target[2].trim();
        if (!maybeValue) {
          data.targets[currentTarget] = {};
        } else {
          data.targets[currentTarget] = { path: parseScalar(maybeValue), enabled: true };
        }
        continue;
      }

      if (indent >= 4 && currentTarget) {
        const pair = line.match(/^([a-zA-Z0-9_-]+):(.*)$/);
        if (pair) {
          if (!data.targets[currentTarget] || typeof data.targets[currentTarget] !== "object") {
            data.targets[currentTarget] = {};
          }
          data.targets[currentTarget][pair[1]] = parseScalar(pair[2].trim());
        }
      }
    }
  }

  return data;
}

function quoteYaml(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || typeof value === "undefined") {
    return "null";
  }
  return JSON.stringify(String(value));
}

function inferCommandFromScripts(scripts, scriptName) {
  if (scripts && typeof scripts[scriptName] === "string") {
    return `npm run ${scriptName}`;
  }
  return `echo "TODO: define ${scriptName} command"`;
}

function createDefaultRules(scripts) {
  const targets = {};
  for (const adapter of ADAPTERS) {
    targets[adapter.id] = {
      enabled: true,
      path: adapter.defaultPath,
    };
  }

  return {
    version: 2,
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
    targets,
  };
}

function normalizeTargetConfig(source, fallbackPath) {
  if (typeof source === "string" && source.trim()) {
    return { enabled: true, path: source.trim() };
  }

  if (!source || typeof source !== "object") {
    return { enabled: true, path: fallbackPath };
  }

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    path: typeof source.path === "string" && source.path.trim() ? source.path.trim() : fallbackPath,
  };
}

function normalizeRules(input, defaults) {
  const source = input && typeof input === "object" ? input : {};
  const commands = source.commands && typeof source.commands === "object" ? source.commands : {};
  const approvals =
    source.approvals && typeof source.approvals === "object" ? source.approvals : {};
  const sourceTargets = source.targets && typeof source.targets === "object" ? source.targets : {};

  const workflow = Array.isArray(source.workflow)
    ? source.workflow.filter((item) => typeof item === "string")
    : defaults.workflow;

  const done = Array.isArray(source.done)
    ? source.done.filter((item) => typeof item === "string")
    : defaults.done;

  const notes = Array.isArray(approvals.notes)
    ? approvals.notes.filter((item) => typeof item === "string")
    : defaults.approvals.notes;

  const targets = {};
  for (const adapter of ADAPTERS) {
    targets[adapter.id] = normalizeTargetConfig(sourceTargets[adapter.id], defaults.targets[adapter.id].path);
  }

  for (const customId of Object.keys(sourceTargets)) {
    if (targets[customId]) {
      continue;
    }
    targets[customId] = normalizeTargetConfig(sourceTargets[customId], `${customId.toUpperCase()}.md`);
  }

  return {
    version: typeof source.version === "number" ? source.version : defaults.version,
    mission:
      typeof source.mission === "string" && source.mission.trim() ? source.mission : defaults.mission,
    workflow: workflow.length > 0 ? workflow : defaults.workflow,
    commands: {
      lint: typeof commands.lint === "string" ? commands.lint : defaults.commands.lint,
      test: typeof commands.test === "string" ? commands.test : defaults.commands.test,
      build: typeof commands.build === "string" ? commands.build : defaults.commands.build,
    },
    done: done.length > 0 ? done : defaults.done,
    approvals: {
      mode: typeof approvals.mode === "string" ? approvals.mode : defaults.approvals.mode,
      notes,
    },
    targets,
  };
}

function stringifyRules(rules) {
  const knownTargetIds = ADAPTERS.map((adapter) => adapter.id);
  const allTargetIds = [
    ...knownTargetIds.filter((id) => Object.prototype.hasOwnProperty.call(rules.targets || {}, id)),
    ...Object.keys(rules.targets || {})
      .filter((id) => !knownTargetIds.includes(id))
      .sort(),
  ];

  const lines = [
    `version: ${quoteYaml(Number.isFinite(rules.version) ? rules.version : 2)}`,
    `mission: ${quoteYaml(rules.mission)}`,
    "workflow:",
    ...rules.workflow.map((step) => `  - ${quoteYaml(step)}`),
    "commands:",
    ...Object.keys(rules.commands).map((name) => `  ${name}: ${quoteYaml(rules.commands[name])}`),
    "done:",
    ...rules.done.map((item) => `  - ${quoteYaml(item)}`),
    "approvals:",
    `  mode: ${quoteYaml(rules.approvals.mode)}`,
    "  notes:",
    ...rules.approvals.notes.map((note) => `    - ${quoteYaml(note)}`),
    "targets:",
  ];

  for (const id of allTargetIds) {
    const config = normalizeTargetConfig(rules.targets[id], `${id.toUpperCase()}.md`);
    lines.push(`  ${id}:`);
    lines.push(`    enabled: ${quoteYaml(config.enabled)}`);
    lines.push(`    path: ${quoteYaml(config.path)}`);
  }

  lines.push("");
  return lines.join("\n");
}

function hasVerifyCommand(text) {
  return /\b(npm run|pnpm|yarn|bun)\s+(lint|test|build)\b/i.test(text);
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

function resolveInRoot(rootDir, filePath) {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(rootDir, filePath);
}

function findProjectRoot(startDir) {
  let current = resolve(startDir);
  while (true) {
    const gitPath = resolve(current, ".git");
    const rulesPath = resolve(current, RULES_RELATIVE_PATH);
    if (existsSync(rulesPath) || existsSync(gitPath)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir);
    }
    current = parent;
  }
}

function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function upsertManagedSection(existing, content, beginMarker, endMarker) {
  const start = existing.indexOf(beginMarker);
  const end = start >= 0 ? existing.indexOf(endMarker, start) : -1;

  if (start >= 0 && end > start) {
    const before = existing.slice(0, start + beginMarker.length);
    const after = existing.slice(end);
    return `${before}\n${content.trim()}\n${after}`.replace(/\n{3,}/g, "\n\n");
  }

  const base = existing.trimEnd();
  const prefix = base ? `${base}\n\n` : "";
  return `${prefix}${beginMarker}\n${content.trim()}\n${endMarker}\n`;
}

function loadPackageScripts(rootDir) {
  const pkg = readJsonFile(resolve(rootDir, "package.json"));
  if (!pkg || typeof pkg !== "object" || !pkg.scripts || typeof pkg.scripts !== "object") {
    return {};
  }
  return pkg.scripts;
}

function loadRules(rootDir, options) {
  const rulesFile = resolve(rootDir, RULES_RELATIVE_PATH);
  const defaults = createDefaultRules(loadPackageScripts(rootDir));

  if (!existsSync(rulesFile)) {
    if (options && options.allowMissing) {
      return {
        rules: defaults,
        rulesFile,
        rulesExists: false,
      };
    }
    throw new Error(`Missing ${rulesFile}. Run "rules-doctor init" to create it first.`);
  }

  const parsed = parseRulesText(readFileSync(rulesFile, "utf8"));
  return {
    rules: normalizeRules(parsed, defaults),
    rulesFile,
    rulesExists: true,
  };
}

function getTargetsFromSpec(spec) {
  if (spec === "all") {
    return ADAPTERS.map((adapter) => adapter.id);
  }

  const unique = [];
  for (const raw of spec.split(",")) {
    const id = raw.trim();
    if (!id) {
      continue;
    }
    if (!ADAPTERS_BY_ID[id]) {
      throw new Error(
        `Unknown target "${id}". Use one of: all, ${ADAPTERS.map((adapter) => adapter.id).join(", ")}`,
      );
    }
    if (!unique.includes(id)) {
      unique.push(id);
    }
  }

  if (unique.length === 0) {
    throw new Error("No targets selected.");
  }

  return unique;
}

function parseSyncTargets(args) {
  if (!args || args.length === 0) {
    return ADAPTERS.map((adapter) => adapter.id);
  }

  let targetSpec = "all";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --target");
      }
      targetSpec = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for sync: ${arg}`);
  }

  return getTargetsFromSpec(targetSpec);
}

function parseAnalyzeArgs(args) {
  if (!args || args.length === 0) {
    return {};
  }

  for (const arg of args) {
    if (arg === "--strict") {
      return { strict: true };
    }
    throw new Error(`Unknown option for analyze: ${arg}`);
  }

  return {};
}

function getTargetConfig(rules, adapter) {
  const source = rules.targets && typeof rules.targets === "object" ? rules.targets[adapter.id] : null;
  return normalizeTargetConfig(source, adapter.defaultPath);
}

function initCommand(rootDir, logger) {
  const rulesFile = resolve(rootDir, RULES_RELATIVE_PATH);
  if (existsSync(rulesFile)) {
    logger.log(`rules.yaml already exists: ${rulesFile}`);
    return;
  }

  const defaults = createDefaultRules(loadPackageScripts(rootDir));
  ensureParentDirectory(rulesFile);
  writeFileSync(rulesFile, stringifyRules(defaults), "utf8");
  logger.log(`Created ${rulesFile}`);
}

function syncCommand(rootDir, logger, args) {
  const { rules } = loadRules(rootDir);
  const selectedTargetIds = parseSyncTargets(args);

  let updated = 0;
  for (const targetId of selectedTargetIds) {
    const adapter = ADAPTERS_BY_ID[targetId];
    const target = getTargetConfig(rules, adapter);

    if (!target.enabled) {
      logger.log(`Skipped ${targetId} (disabled in rules.yaml).`);
      continue;
    }

    const targetPath = resolveInRoot(rootDir, target.path);
    const rendered = adapter.render(rules).trim();
    ensureParentDirectory(targetPath);

    if (adapter.management === "marker") {
      const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
      const updatedText = upsertManagedSection(
        existing,
        rendered,
        adapter.markerBegin,
        adapter.markerEnd,
      );
      writeFileSync(targetPath, updatedText, "utf8");
    } else {
      writeFileSync(targetPath, `${rendered}\n`, "utf8");
    }

    logger.log(`Updated ${targetPath} (${targetId})`);
    updated += 1;
  }

  if (updated === 0) {
    logger.log("No files updated.");
  }
}

function analyzeCommand(rootDir, logger, args) {
  const options = parseAnalyzeArgs(args);
  const { rules, rulesExists, rulesFile } = loadRules(rootDir, { allowMissing: true });
  const issues = [];
  const targetSnapshots = [];

  logger.log("rules-doctor analyze");
  logger.log(`- rules.yaml: ${rulesExists ? "found" : "missing (using defaults)"}`);
  logger.log(`- rules path: ${rulesFile}`);

  for (const adapter of ADAPTERS) {
    const target = getTargetConfig(rules, adapter);
    const absolutePath = resolveInRoot(rootDir, target.path);
    const fileExists = existsSync(absolutePath);
    const content = fileExists ? readFileSync(absolutePath, "utf8") : "";

    logger.log(
      `- target ${adapter.id}: ${target.enabled ? "enabled" : "disabled"}, ${
        fileExists ? "found" : "missing"
      } (${target.path})`,
    );

    if (!target.enabled) {
      continue;
    }

    if (!fileExists) {
      issues.push(`${adapter.id}: expected file is missing (${target.path}).`);
      continue;
    }

    if (adapter.management === "marker") {
      const hasBegin = content.includes(adapter.markerBegin);
      const hasEnd = content.includes(adapter.markerEnd);
      if (!hasBegin || !hasEnd) {
        issues.push(`${adapter.id}: marker block is missing.`);
      }
    }

    if (!hasVerifyCommand(content)) {
      issues.push(`${adapter.id}: verify commands (lint/test/build) not detected.`);
    }

    targetSnapshots.push({
      id: adapter.id,
      content,
      asksApproval: hasAskApprovalLanguage(content),
      noApproval: hasNoApprovalLanguage(content),
      requiresTests: hasRequireTestsLanguage(content),
      skipsTests: hasSkipTestsLanguage(content),
    });
  }

  const askApprovalTargets = targetSnapshots.filter((item) => item.asksApproval).map((item) => item.id);
  const noApprovalTargets = targetSnapshots.filter((item) => item.noApproval).map((item) => item.id);
  if (askApprovalTargets.length > 0 && noApprovalTargets.length > 0) {
    issues.push(
      `Potential contradiction: approval guidance differs (${askApprovalTargets.join(
        ", ",
      )} vs ${noApprovalTargets.join(", ")}).`,
    );
  }

  const requireTestsTargets = targetSnapshots
    .filter((item) => item.requiresTests)
    .map((item) => item.id);
  const skipTestsTargets = targetSnapshots.filter((item) => item.skipsTests).map((item) => item.id);
  if (requireTestsTargets.length > 0 && skipTestsTargets.length > 0) {
    issues.push(
      `Potential contradiction: test guidance differs (${requireTestsTargets.join(
        ", ",
      )} vs ${skipTestsTargets.join(", ")}).`,
    );
  }

  logger.log("- Findings:");
  if (issues.length === 0) {
    logger.log("- No obvious issues found.");
    return 0;
  }

  for (const issue of issues) {
    logger.log(`- ${issue}`);
  }

  if (options.strict) {
    throw new Error(`Analyze failed in strict mode with ${issues.length} issue(s).`);
  }

  return 0;
}

function targetsListCommand(logger) {
  logger.log("Supported targets:");
  for (const adapter of ADAPTERS) {
    const mode = adapter.management === "marker" ? "marker-managed" : "full-managed";
    logger.log(`- ${adapter.id}: ${adapter.name}`);
    logger.log(`  default path: ${adapter.defaultPath}`);
    logger.log(`  mode: ${mode}`);
    logger.log(`  ${adapter.description}`);
  }
}

function runCli(argv, options) {
  const args = Array.isArray(argv) ? argv : [];
  const logger = createLogger(options || {});
  const cwd = resolve(options && options.cwd ? options.cwd : process.cwd());
  const rootDir = findProjectRoot(cwd);

  try {
    const [command, ...rest] = args;

    if (!command || command === "--help" || command === "-h") {
      logger.log(usage());
      return 0;
    }

    if (command === "init") {
      initCommand(rootDir, logger);
      return 0;
    }

    if (command === "sync") {
      syncCommand(rootDir, logger, rest);
      return 0;
    }

    if (command === "analyze") {
      return analyzeCommand(rootDir, logger, rest);
    }

    if (command === "targets") {
      if (rest.length === 1 && rest[0] === "list") {
        targetsListCommand(logger);
        return 0;
      }
      throw new Error('Unknown targets command. Use "rules-doctor targets list".');
    }

    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error: ${message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

module.exports = {
  ADAPTERS,
  createDefaultRules,
  normalizeRules,
  parseRulesText,
  runCli,
  stringifyRules,
};
