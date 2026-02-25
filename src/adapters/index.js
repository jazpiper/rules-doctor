const claude = require("./claude");
const codex = require("./codex");
const cursor = require("./cursor");
const gemini = require("./gemini");
const opencode = require("./opencode");
const antigravity = require("./antigravity");

const ADAPTERS = [claude, codex, cursor, gemini, opencode, antigravity];
const ADAPTERS_BY_ID = Object.fromEntries(ADAPTERS.map((adapter) => [adapter.id, adapter]));

module.exports = {
  ADAPTERS,
  ADAPTERS_BY_ID,
};
