const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "cursor",
  name: "Cursor",
  description: "Manage .cursor/rules/rules-doctor.mdc as an always-applied project rule.",
  defaultPath: ".cursor/rules/rules-doctor.mdc",
  management: "full",
  render(rules) {
    return [
      "---",
      "description: rules-doctor managed coding rules",
      "alwaysApply: true",
      "---",
      "",
      renderManagedRulesBody(rules),
    ].join("\n");
  },
};
