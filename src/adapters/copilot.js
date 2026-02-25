const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "copilot",
  name: "GitHub Copilot",
  description:
    "Manage .github/copilot-instructions.md via marker-managed section to preserve user content.",
  defaultPath: ".github/copilot-instructions.md",
  management: "marker",
  markerBegin: "<!-- RULES_DOCTOR:COPILOT:BEGIN -->",
  markerEnd: "<!-- RULES_DOCTOR:COPILOT:END -->",
  render(rules) {
    return ["# Copilot Instructions", "", renderManagedRulesBody(rules)].join("\n");
  },
};
