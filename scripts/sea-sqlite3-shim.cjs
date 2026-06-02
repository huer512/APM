"use strict";

const path = require("node:path");

function resolveSqlite3Module() {
  const runtimeDir = process.env.APM_SEA_RUNTIME_DIR;
  if (runtimeDir) {
    return require(path.join(runtimeDir, "node_modules/sqlite3/lib/sqlite3.js"));
  }
  return require("sqlite3");
}

module.exports = resolveSqlite3Module();
