#!/usr/bin/env node
const { dirname, isAbsolute, relative, resolve } = require("node:path");
const { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { ADAPTERS, ADAPTERS_BY_ID } = require("./adapters");

const RULES_RELATIVE_PATH = ".agentrules/rules.yaml";
const IMPORT_REPORT_RELATIVE_PATH = ".agentrules/import-report.md";
const REQUIRED_RULE_KEYS = [
  "version",
  "mission",
  "workflow",
  "commands",
  "done",
  "approvals",
  "targets",
];

function usage() {
  const targets = ADAPTERS.map((adapter) => adapter.id).join("|");
  return [
    "rules-doctor",
    "",
    "Usage:",
    "  rules-doctor init [--import]",
    `  rules-doctor sync [--target all|${targets}|<comma-separated-targets>] [--diff] [--write] [--backup]`,
    `  rules-doctor check [--target all|${targets}|<comma-separated-targets>] [--diff]`,
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
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function stripInlineComment(value) {
  const input = String(value);
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inDouble) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      if (inSingle && input[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === "#" && !inSingle && !inDouble) {
      const previous = index > 0 ? input[index - 1] : " ";
      if (/\s/.test(previous)) {
        return input.slice(0, index).trimEnd();
      }
    }
  }

  return input.trimEnd();
}

function splitTopLevel(value, delimiter) {
  const input = String(value);
  const parts = [];
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let last = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inDouble) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      if (inSingle && input[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) {
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (char === delimiter && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      parts.push(input.slice(last, index));
      last = index + 1;
    }
  }

  parts.push(input.slice(last));
  return parts;
}

function splitKeyValueLine(line, options) {
  const opts = options || {};
  const input = String(line);
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inDouble) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      if (inSingle && input[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === ":" && !inSingle && !inDouble) {
      const next = input[index + 1];
      if (!opts.allowTightValue && typeof next !== "undefined" && !/\s/.test(next)) {
        continue;
      }
      const key = stripQuotes(input.slice(0, index).trim());
      if (!key) {
        return null;
      }
      return [key, input.slice(index + 1)];
    }
  }

  return null;
}

function parseInlineCollection(value) {
  const input = String(value).trim();
  if (input.startsWith("{") && input.endsWith("}")) {
    const inner = input.slice(1, -1).trim();
    if (!inner) {
      return {};
    }

    const result = {};
    for (const entry of splitTopLevel(inner, ",")) {
      const item = entry.trim();
      if (!item) {
        continue;
      }

      const pair = splitKeyValueLine(item, { allowTightValue: true });
      if (!pair) {
        return undefined;
      }
      result[pair[0]] = parseScalar(pair[1]);
    }
    return result;
  }

  if (input.startsWith("[") && input.endsWith("]")) {
    const inner = input.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitTopLevel(inner, ",").map((item) => parseScalar(item.trim()));
  }

  return undefined;
}

function isBlockScalarIndicator(value) {
  const cleaned = stripInlineComment(value).trim();
  return /^[|>][-+]?$/.test(cleaned);
}

function foldBlockLines(lines) {
  let output = "";
  for (const line of lines) {
    if (line === "") {
      output += "\n";
      continue;
    }
    if (output === "" || output.endsWith("\n")) {
      output += line;
    } else {
      output += ` ${line}`;
    }
  }
  return output;
}

function parseBlockScalar(lines, startIndex, baseIndent, indicator) {
  const style = String(indicator).trim().startsWith(">") ? ">" : "|";
  const rawBlock = [];
  let minIndent = Infinity;
  let index = startIndex + 1;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      rawBlock.push("");
      index += 1;
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    if (indent <= baseIndent) {
      break;
    }

    minIndent = Math.min(minIndent, indent);
    rawBlock.push(rawLine);
    index += 1;
  }

  if (rawBlock.length === 0) {
    return { value: "", nextIndex: startIndex };
  }

  const normalized = rawBlock.map((line) => {
    if (!line) {
      return "";
    }
    return line.slice(Math.min(minIndent, line.match(/^ */)[0].length));
  });

  const value = style === ">" ? foldBlockLines(normalized) : normalized.join("\n");
  return { value: value.trimEnd(), nextIndex: index - 1 };
}

function parseScalar(value) {
  const withoutComment = stripInlineComment(value).trim();
  if (!withoutComment) {
    return "";
  }

  const inlineCollection = parseInlineCollection(withoutComment);
  if (typeof inlineCollection !== "undefined") {
    return inlineCollection;
  }

  const cleaned = stripQuotes(withoutComment);
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
  let targetEntryIndent = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      nested = null;
      currentTarget = null;
      targetEntryIndent = null;

      const top = splitKeyValueLine(line);
      if (!top) {
        continue;
      }

      const key = top[0];
      const value = stripInlineComment(top[1]).trim();

      if (!value) {
        section = key;
        if (key === "workflow" || key === "done") {
          data[key] = [];
        } else if (key === "commands" || key === "approvals" || key === "targets") {
          data[key] = {};
        }
      } else {
        section = null;
        if (isBlockScalarIndicator(value)) {
          const parsedBlock = parseBlockScalar(lines, lineIndex, indent, value);
          data[key] = parsedBlock.value;
          lineIndex = parsedBlock.nextIndex;
        } else {
          data[key] = parseScalar(value);
        }
      }
      continue;
    }

    if ((section === "workflow" || section === "done") && line.startsWith("- ")) {
      data[section].push(parseScalar(line.slice(2)));
      continue;
    }

    if (section === "commands") {
      const pair = splitKeyValueLine(line);
      if (pair) {
        data.commands[pair[0]] = parseScalar(pair[1]);
      }
      continue;
    }

    if (section === "approvals") {
      const pair = splitKeyValueLine(line);

      if (pair && pair[0] === "mode") {
        data.approvals.mode = parseScalar(pair[1]);
        continue;
      }

      if (pair && pair[0] === "notes" && !stripInlineComment(pair[1]).trim()) {
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
      const pair = splitKeyValueLine(line);
      if (!pair) {
        continue;
      }

      const key = pair[0];
      const maybeValue = stripInlineComment(pair[1]).trim();

      if (targetEntryIndent === null) {
        targetEntryIndent = indent;
      }

      if (indent === targetEntryIndent) {
        currentTarget = key;
        if (!maybeValue) {
          data.targets[currentTarget] = {};
        } else {
          data.targets[currentTarget] = { path: parseScalar(maybeValue), enabled: true };
        }
        continue;
      }

      if (indent > targetEntryIndent && currentTarget) {
        if (!data.targets[currentTarget] || typeof data.targets[currentTarget] !== "object") {
          data.targets[currentTarget] = {};
        }
        data.targets[currentTarget][key] = parseScalar(maybeValue);
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
  const normalizedCommands = {};
  for (const [name, value] of Object.entries(commands)) {
    const normalizedName = String(name).trim();
    if (!normalizedName || typeof value !== "string" || !value.trim()) {
      continue;
    }
    normalizedCommands[normalizedName] = value.trim();
  }

  for (const required of ["lint", "test", "build"]) {
    if (!normalizedCommands[required] && defaults.commands[required]) {
      normalizedCommands[required] = defaults.commands[required];
    }
  }

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
    commands: normalizedCommands,
    done: done.length > 0 ? done : defaults.done,
    approvals: {
      mode: typeof approvals.mode === "string" ? approvals.mode : defaults.approvals.mode,
      notes,
    },
    targets,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSuspiciousRuleLines(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const suspicious = [];
  let blockBaseIndent = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    if (blockBaseIndent !== null) {
      if (!trimmed) {
        continue;
      }
      if (indent > blockBaseIndent) {
        continue;
      }
      blockBaseIndent = null;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const pair = splitKeyValueLine(trimmed, { allowTightValue: true });
    if (pair) {
      if (isBlockScalarIndicator(pair[1])) {
        blockBaseIndent = indent;
      }
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      continue;
    }

    suspicious.push(index + 1);
  }
  return suspicious;
}

function validateRulesSource(source, rawText) {
  const warnings = [];
  const errors = [];

  if (!isPlainObject(source)) {
    errors.push("Top-level YAML must be an object.");
    return { warnings, errors };
  }

  const keys = Object.keys(source);
  const nonCommentLines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (keys.length === 0 && nonCommentLines.length > 0) {
    errors.push("No parseable keys found. Check YAML syntax and indentation.");
  }

  for (const key of REQUIRED_RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      warnings.push(`Missing "${key}" key; defaults will be applied.`);
    }
  }

  const suspiciousLines = getSuspiciousRuleLines(rawText);
  if (suspiciousLines.length > 0) {
    warnings.push(
      `Suspicious YAML line(s): ${suspiciousLines.slice(0, 8).join(", ")}${
        suspiciousLines.length > 8 ? ", ..." : ""
      }`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(source, "version") && typeof source.version !== "number") {
    errors.push(`"version" must be a number.`);
  }
  if (
    Object.prototype.hasOwnProperty.call(source, "mission") &&
    (typeof source.mission !== "string" || !source.mission.trim())
  ) {
    errors.push(`"mission" must be a non-empty string.`);
  }
  if (
    Object.prototype.hasOwnProperty.call(source, "workflow") &&
    (!Array.isArray(source.workflow) || source.workflow.some((item) => typeof item !== "string"))
  ) {
    errors.push(`"workflow" must be an array of strings.`);
  }
  if (
    Object.prototype.hasOwnProperty.call(source, "done") &&
    (!Array.isArray(source.done) || source.done.some((item) => typeof item !== "string"))
  ) {
    errors.push(`"done" must be an array of strings.`);
  }

  if (Object.prototype.hasOwnProperty.call(source, "commands")) {
    if (!isPlainObject(source.commands)) {
      errors.push(`"commands" must be an object.`);
    } else {
      for (const [name, value] of Object.entries(source.commands)) {
        if (typeof value !== "string" || !value.trim()) {
          errors.push(`"commands.${name}" must be a non-empty string.`);
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "approvals")) {
    if (!isPlainObject(source.approvals)) {
      errors.push(`"approvals" must be an object.`);
    } else {
      if (
        Object.prototype.hasOwnProperty.call(source.approvals, "mode") &&
        (typeof source.approvals.mode !== "string" || !source.approvals.mode.trim())
      ) {
        errors.push(`"approvals.mode" must be a non-empty string.`);
      }
      if (
        Object.prototype.hasOwnProperty.call(source.approvals, "notes") &&
        (!Array.isArray(source.approvals.notes) ||
          source.approvals.notes.some((item) => typeof item !== "string"))
      ) {
        errors.push(`"approvals.notes" must be an array of strings.`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "targets")) {
    if (!isPlainObject(source.targets)) {
      errors.push(`"targets" must be an object.`);
    } else {
      for (const [targetId, config] of Object.entries(source.targets)) {
        if (typeof config === "string") {
          if (!config.trim()) {
            errors.push(`"targets.${targetId}" must not be empty.`);
          }
          continue;
        }
        if (!isPlainObject(config)) {
          errors.push(`"targets.${targetId}" must be a string or object.`);
          continue;
        }
        if (
          Object.prototype.hasOwnProperty.call(config, "enabled") &&
          typeof config.enabled !== "boolean"
        ) {
          errors.push(`"targets.${targetId}.enabled" must be boolean.`);
        }
        if (Object.prototype.hasOwnProperty.call(config, "path")) {
          if (typeof config.path !== "string" || !config.path.trim()) {
            errors.push(`"targets.${targetId}.path" must be a non-empty string.`);
          }
        } else {
          warnings.push(`"targets.${targetId}" has no "path"; default path will be used.`);
        }
      }
    }
  }

  return { warnings, errors };
}

function formatValidationMessages(validation) {
  const lines = [];
  if (validation.errors.length > 0) {
    lines.push("rules.yaml validation errors:");
    for (const error of validation.errors) {
      lines.push(`- ${error}`);
    }
  }
  if (validation.warnings.length > 0) {
    lines.push("rules.yaml validation warnings:");
    for (const warning of validation.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return lines.join("\n");
}

function stringifyRules(rules) {
  const knownTargetIds = ADAPTERS.map((adapter) => adapter.id);
  const allTargetIds = [
    ...knownTargetIds.filter((id) => Object.prototype.hasOwnProperty.call(rules.targets || {}, id)),
    ...Object.keys(rules.targets || {})
      .filter((id) => !knownTargetIds.includes(id))
      .sort(),
  ];

  const commandNames = Object.keys(rules.commands || {});
  const orderedCommandNames = [
    ...["lint", "test", "build"].filter((name) => commandNames.includes(name)),
    ...commandNames.filter((name) => !["lint", "test", "build"].includes(name)).sort(),
  ];

  const lines = [
    `version: ${quoteYaml(Number.isFinite(rules.version) ? rules.version : 2)}`,
    `mission: ${quoteYaml(rules.mission)}`,
    "workflow:",
    ...rules.workflow.map((step) => `  - ${quoteYaml(step)}`),
    "commands:",
    ...orderedCommandNames.map((name) => `  ${name}: ${quoteYaml(rules.commands[name])}`),
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

function resolveInRoot(rootDir, filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Target path must be a non-empty string.");
  }

  const trimmedPath = filePath.trim();
  if (isAbsolute(trimmedPath)) {
    throw new Error(`Target path must be project-relative: ${trimmedPath}`);
  }

  const resolvedPath = resolve(rootDir, trimmedPath);
  const rel = relative(rootDir, resolvedPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Target path escapes project root: ${trimmedPath}`);
  }

  return resolvedPath;
}

function assertNoSymlinkTraversal(rootDir, targetPath) {
  const rel = relative(rootDir, targetPath);
  if (!rel || rel === ".") {
    return;
  }

  const segments = rel.split(/[/\\]+/).filter(Boolean);
  let cursor = rootDir;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) {
      continue;
    }
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink()) {
      const display = relative(rootDir, cursor) || ".";
      throw new Error(`Refusing symlink path for managed output: ${display}`);
    }
  }
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

function countOccurrences(text, needle) {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) {
      return count;
    }
    count += 1;
    cursor = index + needle.length;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inspectMarkerBlock(text, beginMarker, endMarker) {
  const beginCount = countOccurrences(text, beginMarker);
  const endCount = countOccurrences(text, endMarker);
  const firstBegin = text.indexOf(beginMarker);
  const firstEnd = text.indexOf(endMarker);

  if (beginCount === 0 && endCount === 0) {
    return { status: "missing", beginCount, endCount, firstBegin, firstEnd };
  }
  if (beginCount === 1 && endCount === 1 && firstBegin >= 0 && firstEnd > firstBegin) {
    return { status: "valid", beginCount, endCount, firstBegin, firstEnd };
  }
  if (beginCount === 1 && endCount === 0) {
    return { status: "missing-end", beginCount, endCount, firstBegin, firstEnd };
  }
  if (beginCount === 0 && endCount === 1) {
    return { status: "missing-begin", beginCount, endCount, firstBegin, firstEnd };
  }
  if (firstBegin >= 0 && firstEnd >= 0 && firstEnd < firstBegin) {
    return { status: "misordered", beginCount, endCount, firstBegin, firstEnd };
  }
  return { status: "multiple", beginCount, endCount, firstBegin, firstEnd };
}

function markerStatusIssueLabel(status) {
  if (status === "missing") {
    return "marker block is missing.";
  }
  if (status === "missing-end") {
    return "marker block is malformed (missing end marker).";
  }
  if (status === "missing-begin") {
    return "marker block is malformed (missing begin marker).";
  }
  if (status === "misordered") {
    return "marker block is malformed (end marker appears before begin marker).";
  }
  if (status === "multiple") {
    return "marker block is malformed (multiple marker blocks detected).";
  }
  return "marker block state is unknown.";
}

function removeMarkerLines(text, beginMarker, endMarker) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== beginMarker && trimmed !== endMarker;
    })
    .join("\n");
}

function cleanMalformedMarkerContent(existing, beginMarker, endMarker, inspection) {
  if (inspection.status === "missing-end" && inspection.firstBegin >= 0) {
    return existing.slice(0, inspection.firstBegin).trimEnd();
  }

  let cleaned = existing;
  const beginPattern = escapeRegExp(beginMarker);
  const endPattern = escapeRegExp(endMarker);
  const sectionPattern = new RegExp(`${beginPattern}[\\s\\S]*?${endPattern}\\n?`, "g");
  cleaned = cleaned.replace(sectionPattern, "");
  cleaned = removeMarkerLines(cleaned, beginMarker, endMarker);
  return cleaned.trimEnd();
}

function upsertManagedSection(existing, content, beginMarker, endMarker) {
  const inspection = inspectMarkerBlock(existing, beginMarker, endMarker);
  if (inspection.status === "valid") {
    const before = existing.slice(0, inspection.firstBegin + beginMarker.length);
    const after = existing.slice(inspection.firstEnd);
    return `${before}\n${content.trim()}\n${after}`.replace(/\n{3,}/g, "\n\n");
  }

  const managedBlock = `${beginMarker}\n${content.trim()}\n${endMarker}\n`;
  if (inspection.status === "missing") {
    const base = existing.trimEnd();
    const prefix = base ? `${base}\n\n` : "";
    return `${prefix}${managedBlock}`;
  }

  const cleaned = cleanMalformedMarkerContent(existing, beginMarker, endMarker, inspection);
  const base = cleaned.trimEnd();
  const prefix = base ? `${base}\n\n` : "";
  return `${prefix}${managedBlock}`;
}

function loadPackageScripts(rootDir) {
  const pkg = readJsonFile(resolve(rootDir, "package.json"));
  if (!pkg || typeof pkg !== "object" || !pkg.scripts || typeof pkg.scripts !== "object") {
    return {};
  }
  return pkg.scripts;
}

function loadRules(rootDir, options) {
  const opts = options || {};
  const rulesFile = resolve(rootDir, RULES_RELATIVE_PATH);
  const defaults = createDefaultRules(loadPackageScripts(rootDir));

  if (!existsSync(rulesFile)) {
    throw new Error(`Missing ${rulesFile}. Run "rules-doctor init" to create it first.`);
  }

  const rawText = readFileSync(rulesFile, "utf8");
  const parsed = parseRulesText(rawText);
  const validation = validateRulesSource(parsed, rawText);
  if (validation.errors.length > 0) {
    throw new Error(formatValidationMessages(validation));
  }
  if (validation.warnings.length > 0 && opts.logger && typeof opts.logger.log === "function") {
    opts.logger.log(formatValidationMessages(validation));
  }

  return {
    rules: normalizeRules(parsed, defaults),
    rulesFile,
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
  };

  for (let index = 0; index < (args || []).length; index += 1) {
    const arg = args[index];
    if (arg === "--import") {
      options.importExisting = true;
      continue;
    }

    throw new Error(`Unknown option for init: ${arg}`);
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
    { path: "CLAUDE.md" },
    { path: ".claude/CLAUDE.md" },
    { path: "AGENTS.md" },
    { path: ".github/copilot-instructions.md" },
    { path: "GEMINI.md" },
    { path: ".cursor/rules/rules-doctor.mdc" },
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
      path: item.path,
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

  ensureParentDirectory(rulesFile);
  writeFileSync(rulesFile, stringifyRules(rules), "utf8");
  logger.log(`Created ${rulesFile}`);

  if (options.importExisting) {
    const reportPath = resolve(rootDir, IMPORT_REPORT_RELATIVE_PATH);
    writeFileSync(reportPath, `${importReport}\n`, "utf8");
    logger.log(`Import report: ${reportPath}`);
  }

  return 0;
}

function buildTargetPlans(rootDir, rules, targetIds) {
  const plans = [];

  for (const targetId of targetIds) {
    const adapter = ADAPTERS_BY_ID[targetId];
    const target = getTargetConfig(rules, adapter);
    const targetPath = resolveInRoot(rootDir, target.path);
    assertNoSymlinkTraversal(rootDir, targetPath);
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
  return { changed, changedFiles };
}

function analyzeSharedPathPlans(plans) {
  const groups = new Map();
  for (const plan of plans) {
    if (!plan.enabled) {
      continue;
    }
    if (!groups.has(plan.targetPath)) {
      groups.set(plan.targetPath, []);
    }
    groups.get(plan.targetPath).push(plan);
  }

  const shared = [];
  const conflicts = [];
  for (const plansAtPath of groups.values()) {
    if (plansAtPath.length < 2) {
      continue;
    }

    const ids = plansAtPath.map((plan) => plan.targetId);
    const firstDesired = plansAtPath[0].desiredText;
    const sameDesired = plansAtPath.every((plan) => plan.desiredText === firstDesired);
    if (sameDesired) {
      shared.push({
        targetPathDisplay: plansAtPath[0].targetPathDisplay,
        ids,
      });
      continue;
    }

    conflicts.push({
      targetPathDisplay: plansAtPath[0].targetPathDisplay,
      ids,
    });
  }

  return { shared, conflicts };
}

function validateSyncPlans(plans) {
  const mapping = analyzeSharedPathPlans(plans);
  const issues = mapping.conflicts.map(
    (group) =>
      `Conflicting outputs map to the same file: ${group.ids.join(", ")} -> ${group.targetPathDisplay}`,
  );
  const warnings = [];

  for (const plan of plans) {
    if (!plan.enabled || !plan.exists || plan.adapter.management !== "marker") {
      continue;
    }
    const marker = inspectMarkerBlock(
      plan.currentText,
      plan.adapter.markerBegin,
      plan.adapter.markerEnd,
    );
    if (marker.status !== "valid" && marker.status !== "missing") {
      warnings.push(
        `${plan.targetId}: ${markerStatusIssueLabel(marker.status)} rules-doctor will repair it on sync.`,
      );
    }
  }

  return { issues, warnings };
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
  const { rules } = loadRules(rootDir, { logger });
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

  if (options.write) {
    const preflight = validateSyncPlans(plans);
    for (const warning of preflight.warnings) {
      logger.log(`  warning: ${warning}`);
    }
    if (preflight.issues.length > 0) {
      logger.log("Sync preflight failed:");
      for (const issue of preflight.issues) {
        logger.log(`  - ${issue}`);
      }
      return 1;
    }
    logger.log("Sync preflight passed.");
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
  const { rules } = loadRules(rootDir, { logger });
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

    if (command === "sync") {
      return syncCommand(rootDir, logger, rest);
    }

    if (command === "check") {
      return checkCommand(rootDir, logger, rest);
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
