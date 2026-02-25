#!/usr/bin/env node
const { dirname, isAbsolute, resolve } = require("node:path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { ADAPTERS, ADAPTERS_BY_ID } = require("./adapters");

const RULES_RELATIVE_PATH = ".agentrules/rules.yaml";
const IMPORT_REPORT_RELATIVE_PATH = ".agentrules/import-report.md";
const PRESET_NAMES = ["all", "core", "copilot"];

function usage() {
  const targets = ADAPTERS.map((adapter) => adapter.id).join("|");
  const presets = PRESET_NAMES.join("|");
  return [
    "rules-doctor",
    "",
    "Usage:",
    `  rules-doctor init [--import] [--preset ${presets}]`,
    `  rules-doctor preset apply <${presets}> [--diff] [--write]`,
    `  rules-doctor sync [--target all|${targets}|<comma-separated-targets>] [--diff] [--write] [--backup]`,
    `  rules-doctor check [--target all|${targets}|<comma-separated-targets>] [--diff]`,
    "  rules-doctor analyze [--strict]",
    "  rules-doctor doctor [--strict]",
    "  rules-doctor targets list",
    "",
    "Notes:",
    "  - sync defaults to dry-run. Add --write to apply changes.",
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

function getPresetTargetIds(presetName) {
  if (presetName === "all") {
    return ADAPTERS.map((adapter) => adapter.id);
  }

  if (presetName === "core") {
    return ["claude", "codex", "opencode", "cursor", "gemini"];
  }

  if (presetName === "copilot") {
    return ["copilot"];
  }

  throw new Error(`Unknown preset "${presetName}". Use one of: ${PRESET_NAMES.join(", ")}`);
}

function applyTargetPreset(rules, presetName) {
  const enabled = new Set(getPresetTargetIds(presetName));
  const targets = rules.targets && typeof rules.targets === "object" ? rules.targets : {};

  for (const adapter of ADAPTERS) {
    const current = normalizeTargetConfig(targets[adapter.id], adapter.defaultPath);
    targets[adapter.id] = {
      enabled: enabled.has(adapter.id),
      path: current.path,
    };
  }

  return {
    ...rules,
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
    const fallback = defaults.targets[adapter.id]
      ? defaults.targets[adapter.id].path
      : adapter.defaultPath;
    const config = normalizeTargetConfig(sourceTargets[adapter.id], fallback);
    targets[adapter.id] = {
      enabled: typeof config.enabled === "boolean" ? config.enabled : true,
      path: config.path,
    };
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

function parseInitArgs(args) {
  const options = {
    importExisting: false,
    preset: "all",
  };

  for (let index = 0; index < (args || []).length; index += 1) {
    const arg = args[index];
    if (arg === "--import") {
      options.importExisting = true;
      continue;
    }

    if (arg === "--preset") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --preset.");
      }
      if (!PRESET_NAMES.includes(value)) {
        throw new Error(`Unknown preset "${value}". Use one of: ${PRESET_NAMES.join(", ")}`);
      }
      options.preset = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for init: ${arg}`);
  }

  return options;
}

function parsePresetArgs(args) {
  if (!args || args.length === 0) {
    throw new Error(`Missing preset subcommand. Use "rules-doctor preset apply <${PRESET_NAMES.join("|")}>".`);
  }

  const [subcommand, presetName, ...rest] = args;
  if (subcommand !== "apply") {
    throw new Error(`Unknown preset subcommand: ${subcommand}. Use "rules-doctor preset apply <preset>".`);
  }

  if (!presetName) {
    throw new Error(`Missing preset name. Use one of: ${PRESET_NAMES.join(", ")}`);
  }
  if (!PRESET_NAMES.includes(presetName)) {
    throw new Error(`Unknown preset "${presetName}". Use one of: ${PRESET_NAMES.join(", ")}`);
  }

  const options = {
    presetName,
    diff: false,
    write: false,
  };

  for (const arg of rest) {
    if (arg === "--diff") {
      options.diff = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    throw new Error(`Unknown option for preset apply: ${arg}`);
  }

  return options;
}

function parseTargetedArgs(commandName, args, extra) {
  const options = {
    targetSpec: "all",
    diff: false,
    write: false,
    backup: false,
  };
  const allowed = extra || {};

  for (let index = 0; index < (args || []).length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value for --target (${commandName})`);
      }
      options.targetSpec = value;
      index += 1;
      continue;
    }
    if (arg === "--diff") {
      options.diff = true;
      continue;
    }
    if (arg === "--write" && allowed.write) {
      options.write = true;
      continue;
    }
    if (arg === "--backup" && allowed.backup) {
      options.backup = true;
      continue;
    }
    throw new Error(`Unknown option for ${commandName}: ${arg}`);
  }

  if (options.backup && !options.write) {
    throw new Error("--backup requires --write.");
  }

  return {
    targetIds: getTargetsFromSpec(options.targetSpec),
    diff: options.diff,
    write: options.write,
    backup: options.backup,
  };
}

function parseAnalyzeArgs(args) {
  const options = {
    strict: false,
  };

  for (const arg of args || []) {
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    throw new Error(`Unknown option for analyze: ${arg}`);
  }

  return options;
}

function parseDoctorArgs(args) {
  const options = {
    strict: false,
  };

  for (const arg of args || []) {
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    throw new Error(`Unknown option for doctor: ${arg}`);
  }

  return options;
}

function getTargetConfig(rules, adapter) {
  const source = rules.targets && typeof rules.targets === "object" ? rules.targets[adapter.id] : null;
  return normalizeTargetConfig(source, adapter.defaultPath);
}

function normalizeHeading(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseMarkdownSections(text) {
  const sections = {};
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let currentHeading = null;
  let currentLines = [];

  function flush() {
    if (!currentHeading) {
      return;
    }
    const normalized = normalizeHeading(currentHeading);
    if (!sections[normalized]) {
      sections[normalized] = currentLines.join("\n").trim();
    }
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      currentHeading = heading[1];
      currentLines = [];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function pickFirstNonEmptyLine(text) {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function parseListItems(text) {
  const items = [];
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet) {
      items.push(bullet[1].trim());
      continue;
    }
    const numbered = line.match(/^\s*\d+\.\s+(.+?)\s*$/);
    if (numbered) {
      items.push(numbered[1].trim());
    }
  }
  return items;
}

function unquoteValue(value) {
  let current = value.trim();
  if (current.startsWith("`") && current.endsWith("`")) {
    current = current.slice(1, -1);
  }
  current = stripQuotes(current);
  return current.trim();
}

function importCommandsFromText(text, commands) {
  const merged = { ...commands };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const commandNames = Object.keys(merged);

  for (const raw of lines) {
    const line = raw.trim();
    for (const name of commandNames) {
      const direct = line.match(new RegExp(`^(?:[-*]\\s*)?${name}\\s*:\\s*(.+)$`, "i"));
      if (direct && direct[1]) {
        merged[name] = unquoteValue(direct[1]);
      }
    }
  }

  for (const name of commandNames) {
    if (!merged[name] || merged[name].includes("TODO")) {
      const found = text.match(new RegExp(`\\b(?:npm run|pnpm|yarn|bun)\\s+${name}\\b`, "i"));
      if (found) {
        merged[name] = found[0];
      }
    }
  }

  return merged;
}

function getSectionText(sections, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeading(alias);
    if (sections[key] && sections[key].trim()) {
      return sections[key].trim();
    }
  }
  return "";
}

function collectImportSources(rootDir) {
  const candidates = [
    { id: "claude", path: "CLAUDE.md" },
    { id: "claude-local", path: ".claude/CLAUDE.md" },
    { id: "codex", path: "AGENTS.md" },
    { id: "copilot", path: ".github/copilot-instructions.md" },
    { id: "gemini", path: "GEMINI.md" },
    { id: "cursor", path: ".cursor/rules/rules-doctor.mdc" },
  ];

  const uniquePaths = new Set();
  const sources = [];

  for (const item of candidates) {
    if (uniquePaths.has(item.path)) {
      continue;
    }
    uniquePaths.add(item.path);

    const absolutePath = resolveInRoot(rootDir, item.path);
    if (!existsSync(absolutePath)) {
      continue;
    }
    sources.push({
      id: item.id,
      path: item.path,
      absolutePath,
      text: readFileSync(absolutePath, "utf8"),
    });
  }

  return sources;
}

function importRulesFromDocs(rootDir, defaults) {
  const imported = JSON.parse(JSON.stringify(defaults));
  const sources = collectImportSources(rootDir);
  const notes = [];

  if (sources.length === 0) {
    return {
      rules: imported,
      report: "No existing docs were found. Created default rules.",
      sources,
    };
  }

  notes.push(`Found ${sources.length} source file(s):`);
  for (const source of sources) {
    notes.push(`- ${source.path}`);
  }

  for (const source of sources) {
    const sections = parseMarkdownSections(source.text);

    const missionSection = getSectionText(sections, ["mission"]);
    if (missionSection) {
      const mission = pickFirstNonEmptyLine(missionSection);
      if (mission) {
        imported.mission = mission;
      }
    }

    const workflowSection = getSectionText(sections, ["workflow", "operational loop"]);
    const workflow = parseListItems(workflowSection);
    if (workflow.length > 0) {
      imported.workflow = workflow;
    }

    const doneSection = getSectionText(sections, ["done", "done criteria"]);
    const done = parseListItems(doneSection);
    if (done.length > 0) {
      imported.done = done;
    }

    const approvalsSection = getSectionText(sections, ["approvals", "approval"]);
    if (approvalsSection) {
      const mode = approvalsSection.match(/(?:mode|policy)\s*:\s*`?([a-z0-9_-]+)`?/i);
      if (mode && mode[1]) {
        imported.approvals.mode = mode[1].trim();
      }
      const approvalNotes = parseListItems(approvalsSection);
      if (approvalNotes.length > 0) {
        imported.approvals.notes = approvalNotes;
      }
    }

    imported.commands = importCommandsFromText(source.text, imported.commands);
  }

  for (const adapter of ADAPTERS) {
    const config = getTargetConfig(imported, adapter);
    const absolutePath = resolveInRoot(rootDir, config.path);
    if (existsSync(absolutePath)) {
      imported.targets[adapter.id].enabled = true;
    }
  }

  notes.push("Imported mission/workflow/commands/done/approvals where detected.");
  return {
    rules: imported,
    report: notes.join("\n"),
    sources,
  };
}

function initCommand(rootDir, logger, args) {
  const options = parseInitArgs(args);
  const rulesFile = resolve(rootDir, RULES_RELATIVE_PATH);
  if (existsSync(rulesFile)) {
    logger.log(`rules.yaml already exists: ${rulesFile}`);
    return 0;
  }

  const defaults = createDefaultRules(loadPackageScripts(rootDir));
  let rules = defaults;
  let importReport = "";

  if (options.importExisting) {
    const imported = importRulesFromDocs(rootDir, defaults);
    rules = imported.rules;
    importReport = imported.report;
  }

  rules = applyTargetPreset(rules, options.preset);

  ensureParentDirectory(rulesFile);
  writeFileSync(rulesFile, stringifyRules(rules), "utf8");
  logger.log(`Created ${rulesFile}`);
  logger.log(`Applied target preset: ${options.preset}`);

  if (options.importExisting) {
    const reportPath = resolve(rootDir, IMPORT_REPORT_RELATIVE_PATH);
    const reportContent =
      options.preset === "all"
        ? `${importReport}\n`
        : `${importReport}\n\nApplied target preset: ${options.preset}\n`;
    writeFileSync(reportPath, reportContent, "utf8");
    logger.log(`Import report: ${reportPath}`);
  }

  return 0;
}

function presetApplyCommand(rootDir, logger, args) {
  const options = parsePresetArgs(args);
  const { rules, rulesFile } = loadRules(rootDir);
  const nextRules = applyTargetPreset(
    {
      ...rules,
      targets: { ...(rules.targets || {}) },
    },
    options.presetName,
  );

  const currentText = stringifyRules(rules);
  const nextText = stringifyRules(nextRules);
  const changed = currentText !== nextText;

  logger.log("rules-doctor preset apply");
  logger.log(`- root: ${rootDir}`);
  logger.log(`- preset: ${options.presetName}`);
  logger.log(`- mode: ${options.write ? "write" : "dry-run"}`);

  if (options.diff && changed) {
    logger.log("\n# diff: .agentrules/rules.yaml");
    logger.log(renderSimpleDiff(currentText, nextText));
  }

  if (!changed) {
    logger.log("No changes required: preset already applied.");
    return 0;
  }

  if (!options.write) {
    logger.log("Dry-run complete: rules.yaml would be updated. Re-run with --write.");
    return 0;
  }

  ensureParentDirectory(rulesFile);
  writeFileSync(rulesFile, nextText, "utf8");
  logger.log(`Updated ${rulesFile}`);
  return 0;
}

function buildTargetPlans(rootDir, rules, targetIds) {
  const plans = [];

  for (const targetId of targetIds) {
    const adapter = ADAPTERS_BY_ID[targetId];
    const target = getTargetConfig(rules, adapter);
    const targetPath = resolveInRoot(rootDir, target.path);
    const fileExists = existsSync(targetPath);
    const currentText = fileExists ? readFileSync(targetPath, "utf8") : "";

    if (!target.enabled) {
      plans.push({
        targetId,
        adapter,
        enabled: false,
        targetPath,
        targetPathDisplay: target.path,
        exists: fileExists,
        currentText,
        desiredText: currentText,
        changed: false,
      });
      continue;
    }

    const rendered = adapter.render(rules).trim();
    const desiredText =
      adapter.management === "marker"
        ? upsertManagedSection(currentText, rendered, adapter.markerBegin, adapter.markerEnd)
        : `${rendered}\n`;

    plans.push({
      targetId,
      adapter,
      enabled: true,
      targetPath,
      targetPathDisplay: target.path,
      exists: fileExists,
      currentText,
      desiredText,
      changed: desiredText !== currentText,
    });
  }

  return plans;
}

function renderSimpleDiff(currentText, desiredText) {
  if (currentText === desiredText) {
    return "";
  }

  const oldLines = currentText.replace(/\r\n/g, "\n").split("\n");
  const newLines = desiredText.replace(/\r\n/g, "\n").split("\n");
  const output = ["--- current", "+++ desired"];
  const maxLines = Math.max(oldLines.length, newLines.length);
  const hardLimit = 120;
  let emitted = 0;

  for (let index = 0; index < maxLines; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];

    if (oldLine === newLine) {
      continue;
    }

    if (typeof oldLine !== "undefined") {
      output.push(`-${oldLine}`);
      emitted += 1;
    }
    if (typeof newLine !== "undefined") {
      output.push(`+${newLine}`);
      emitted += 1;
    }

    if (emitted >= hardLimit) {
      output.push("... diff truncated ...");
      break;
    }
  }

  return output.join("\n");
}

function formatPlanSummary(plans) {
  const changed = plans.filter((plan) => plan.changed).length;
  const changedFiles = new Set(plans.filter((plan) => plan.changed).map((plan) => plan.targetPath)).size;
  const enabled = plans.filter((plan) => plan.enabled).length;
  const disabled = plans.length - enabled;
  return { changed, changedFiles, enabled, disabled };
}

function getUniqueWritePlans(plans) {
  const byPath = new Map();
  const duplicates = [];

  for (const plan of plans) {
    if (!plan.enabled || !plan.changed) {
      continue;
    }

    const existing = byPath.get(plan.targetPath);
    if (!existing) {
      byPath.set(plan.targetPath, plan);
      continue;
    }

    if (existing.desiredText !== plan.desiredText) {
      throw new Error(
        `Conflicting outputs for ${plan.targetPathDisplay}: ${existing.targetId} and ${plan.targetId} produce different content.`,
      );
    }

    duplicates.push({
      targetPathDisplay: plan.targetPathDisplay,
      winner: existing.targetId,
      duplicate: plan.targetId,
    });
  }

  return {
    uniquePlans: Array.from(byPath.values()),
    duplicates,
  };
}

function syncCommand(rootDir, logger, args) {
  const options = parseTargetedArgs("sync", args, { write: true, backup: true });
  const { rules } = loadRules(rootDir);
  const plans = buildTargetPlans(rootDir, rules, options.targetIds);
  const summary = formatPlanSummary(plans);

  logger.log("rules-doctor sync");
  logger.log(`- root: ${rootDir}`);
  logger.log(`- selected targets: ${options.targetIds.join(", ")}`);
  logger.log(`- mode: ${options.write ? "write" : "dry-run"}`);

  for (const plan of plans) {
    if (!plan.enabled) {
      logger.log(`- ${plan.targetId}: disabled (${plan.targetPathDisplay})`);
      continue;
    }
    if (!plan.changed) {
      logger.log(`- ${plan.targetId}: up-to-date (${plan.targetPathDisplay})`);
      continue;
    }
    logger.log(`- ${plan.targetId}: would update (${plan.targetPathDisplay})`);
  }

  if (options.diff) {
    for (const plan of plans) {
      if (!plan.enabled || !plan.changed) {
        continue;
      }
      logger.log(`\n# diff: ${plan.targetId} (${plan.targetPathDisplay})`);
      logger.log(renderSimpleDiff(plan.currentText, plan.desiredText));
    }
  }

  if (!options.write) {
    if (summary.changed === 0) {
      logger.log("Dry-run complete: no changes.");
    } else {
      logger.log(
        `Dry-run complete: ${summary.changedFiles} file(s) would change (${summary.changed} target mappings). Re-run with --write.`,
      );
    }
    return 0;
  }

  const { uniquePlans, duplicates } = getUniqueWritePlans(plans);
  for (const duplicate of duplicates) {
    logger.log(
      `  note: ${duplicate.duplicate} shares output with ${duplicate.winner} at ${duplicate.targetPathDisplay}`,
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const plan of uniquePlans) {
    ensureParentDirectory(plan.targetPath);
    if (options.backup && plan.exists) {
      const backupPath = `${plan.targetPath}.rules-doctor.bak.${timestamp}`;
      writeFileSync(backupPath, plan.currentText, "utf8");
      logger.log(`  backup: ${backupPath}`);
    }

    writeFileSync(plan.targetPath, plan.desiredText, "utf8");
    logger.log(`  updated: ${plan.targetPath}`);
  }

  logger.log(
    `Write complete: ${uniquePlans.length} file(s) updated (${summary.changed} target mappings changed).`,
  );
  return 0;
}

function checkCommand(rootDir, logger, args) {
  const options = parseTargetedArgs("check", args, { write: false, backup: false });
  const { rules } = loadRules(rootDir);
  const plans = buildTargetPlans(rootDir, rules, options.targetIds);
  const summary = formatPlanSummary(plans);

  logger.log("rules-doctor check");
  logger.log(`- root: ${rootDir}`);
  logger.log(`- selected targets: ${options.targetIds.join(", ")}`);

  for (const plan of plans) {
    if (!plan.enabled) {
      logger.log(`- ${plan.targetId}: disabled (${plan.targetPathDisplay})`);
      continue;
    }
    logger.log(
      `- ${plan.targetId}: ${plan.changed ? "drift detected" : "in sync"} (${plan.targetPathDisplay})`,
    );
  }

  if (options.diff) {
    for (const plan of plans) {
      if (!plan.enabled || !plan.changed) {
        continue;
      }
      logger.log(`\n# diff: ${plan.targetId} (${plan.targetPathDisplay})`);
      logger.log(renderSimpleDiff(plan.currentText, plan.desiredText));
    }
  }

  if (summary.changed === 0) {
    logger.log("Check complete: all selected targets are in sync.");
    return 0;
  }

  logger.log(`Check failed: ${summary.changed} target file(s) need sync.`);
  return 1;
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

function doctorCommand(rootDir, logger, args) {
  const options = parseDoctorArgs(args);
  const { rules, rulesExists, rulesFile } = loadRules(rootDir, { allowMissing: true });
  const issues = [];

  logger.log("rules-doctor doctor");
  logger.log(`- root: ${rootDir}`);
  logger.log(`- rules file: ${rulesFile}`);
  logger.log(`- rules exists: ${rulesExists ? "yes" : "no (defaults assumed)"}`);

  const pathToTargets = {};
  for (const adapter of ADAPTERS) {
    const target = getTargetConfig(rules, adapter);
    const absolutePath = resolveInRoot(rootDir, target.path);
    const exists = existsSync(absolutePath);
    const enabledText = target.enabled ? "enabled" : "disabled";
    logger.log(`- ${adapter.id}: ${enabledText}, path=${target.path}, file=${exists ? "found" : "missing"}`);

    if (!target.enabled) {
      continue;
    }

    const key = absolutePath;
    if (!pathToTargets[key]) {
      pathToTargets[key] = [];
    }
    pathToTargets[key].push(adapter.id);
  }

  for (const path of Object.keys(pathToTargets)) {
    const ids = pathToTargets[path];
    if (ids.length > 1) {
      issues.push(`Multiple enabled targets map to the same file: ${ids.join(", ")} -> ${path}`);
    }
  }

  logger.log("- Findings:");
  if (issues.length === 0) {
    logger.log("- No structural issues found.");
    return 0;
  }
  for (const issue of issues) {
    logger.log(`- ${issue}`);
  }

  if (options.strict) {
    return 1;
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
      return initCommand(rootDir, logger, rest);
    }

    if (command === "preset") {
      return presetApplyCommand(rootDir, logger, rest);
    }

    if (command === "sync") {
      return syncCommand(rootDir, logger, rest);
    }

    if (command === "check") {
      return checkCommand(rootDir, logger, rest);
    }

    if (command === "analyze") {
      return analyzeCommand(rootDir, logger, rest);
    }

    if (command === "doctor") {
      return doctorCommand(rootDir, logger, rest);
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
