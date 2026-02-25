#!/usr/bin/env node
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

function parseArgs(argv) {
  const options = {
    clean: false,
    dts: false,
    entry: null,
  };

  for (const arg of argv) {
    if (arg === "--clean") {
      options.clean = true;
      continue;
    }
    if (arg === "--dts") {
      options.dts = true;
      continue;
    }
    if (!arg.startsWith("-") && !options.entry) {
      options.entry = arg;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.entry) {
    throw new Error("Missing entry file.");
  }

  const entryPath = resolve(options.entry);
  const outDir = resolve("dist");
  const outFile = join(outDir, "index.js");
  const dtsFile = join(outDir, "index.d.ts");

  if (options.clean) {
    rmSync(outDir, { recursive: true, force: true });
  }

  mkdirSync(dirname(outFile), { recursive: true });

  const source = readFileSync(entryPath, "utf8");
  // Offline-safe build: source file is plain JS; just copy to dist.
  writeFileSync(outFile, source, "utf8");

  if (options.dts) {
    writeFileSync(dtsFile, "export {};\n", "utf8");
  }

  console.log(`Build complete: ${outFile}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Build failed: ${message}`);
  process.exitCode = 1;
}

