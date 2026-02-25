const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "codex",
  name: "Codex CLI",
  description: "Manage AGENTS.md via marker-managed section.",
  defaultPath: "AGENTS.md",
  management: "marker",
  markerBegin: "<!-- RULES_DOCTOR:BEGIN -->",
  markerEnd: "<!-- RULES_DOCTOR:END -->",
  render(rules) {
    return renderManagedRulesBody(rules);
  },
};
