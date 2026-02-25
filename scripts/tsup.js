#!/usr/bin/env node
const {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");

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

function copyDirectory(sourceDir, outputDir) {
  const entries = readdirSync(sourceDir);
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const stat = statSync(sourcePath);
    const outPath = join(outputDir, relative(sourceDir, sourcePath));

    if (stat.isDirectory()) {
      copyDirectory(sourcePath, outPath);
      continue;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, readFileSync(sourcePath, "utf8"), "utf8");
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.entry) {
    throw new Error("Missing entry file.");
  }

  const entryPath = resolve(options.entry);
  const sourceRoot = dirname(entryPath);
  const outDir = resolve("dist");
  const outFile = join(outDir, "index.js");
  const dtsFile = join(outDir, "index.d.ts");

  if (options.clean) {
    rmSync(outDir, { recursive: true, force: true });
  }

  copyDirectory(sourceRoot, outDir);

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
