const { renderManagedRulesBody } = require("./common");

module.exports = {
  id: "gemini",
  name: "Gemini CLI",
  description: "Generate GEMINI.md managed instruction file.",
  defaultPath: "GEMINI.md",
  management: "full",
  render(rules) {
    return ["# GEMINI.md", "", renderManagedRulesBody(rules)].join("\n");
  },
};
