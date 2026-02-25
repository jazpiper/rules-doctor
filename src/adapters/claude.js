const { formatCommands, formatList } = require("./common");

module.exports = {
  id: "claude",
  name: "Claude Code",
  description: "Generate CLAUDE.md from rules.yaml.",
  defaultPath: "CLAUDE.md",
  management: "full",
  render(rules) {
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
  },
};
