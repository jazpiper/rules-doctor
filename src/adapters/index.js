const claude = require("./claude");
const codex = require("./codex");
const copilot = require("./copilot");
const cursor = require("./cursor");
const gemini = require("./gemini");
const opencode = require("./opencode");

const ADAPTERS = [claude, codex, copilot, cursor, gemini, opencode];
const ADAPTERS_BY_ID = Object.fromEntries(ADAPTERS.map((adapter) => [adapter.id, adapter]));

module.exports = {
  ADAPTERS,
  ADAPTERS_BY_ID,
};
