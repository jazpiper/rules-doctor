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

function renderManagedRulesBody(rules) {
  return [
    "## rules-doctor Managed Rules",
    "Generated from `.agentrules/rules.yaml`. Edit that file, then run `rules-doctor sync`.",
    "",
    "### Mission",
    rules.mission,
    "",
    "### Workflow",
    formatList(rules.workflow),
    "",
    "### Commands",
    formatCommands(rules.commands),
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

module.exports = {
  formatCommands,
  formatList,
  renderManagedRulesBody,
};
