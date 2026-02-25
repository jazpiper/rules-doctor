const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "opencode",
  name: "OpenCode CLI",
  description: "Manage AGENTS.md via marker-managed section (OpenCode rules).",
  defaultPath: "AGENTS.md",
  management: "marker",
  markerBegin: "<!-- RULES_DOCTOR:BEGIN -->",
  markerEnd: "<!-- RULES_DOCTOR:END -->",
  render(rules) {
    return renderManagedRulesBody(rules);
  },
};
