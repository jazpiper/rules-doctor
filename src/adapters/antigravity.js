const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "antigravity",
  name: "Antigravity CLI",
  description: "Generate GEMINI.md-compatible managed instruction file (inferred mapping).",
  defaultPath: "GEMINI.md",
  management: "full",
  render(rules) {
    return ["# GEMINI.md", "", renderManagedRulesBody(rules)].join("\n");
  },
};
