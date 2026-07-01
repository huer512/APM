#!/usr/bin/env node
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleDir = path.join(root, "dist/bundle");
const resourceDir = path.join(root, "apps/apm-desktop/src-tauri/resources/daemon");
const assetsDir = path.join(resourceDir, "assets");

const manifestPath = path.join(bundleDir, "assets-manifest.json");
const daemonBundlePath = path.join(bundleDir, "apm-daemon.bundle.cjs");
const mcpBundlePath = path.join(bundleDir, "apm-mcp.bundle.cjs");

await ensureFile(daemonBundlePath, "Missing daemon bundle. Run `npm run build:bundle` first.");
await ensureFile(mcpBundlePath, "Missing MCP bundle. Run `npm run build:bundle` first.");
await ensureFile(manifestPath, "Missing assets manifest. Run `npm run build:assets` first.");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

await fs.rm(resourceDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });
await fs.copyFile(daemonBundlePath, path.join(resourceDir, "apm-daemon.bundle.cjs"));
await fs.copyFile(mcpBundlePath, path.join(resourceDir, "apm-mcp.bundle.cjs"));
await fs.copyFile(manifestPath, path.join(resourceDir, "assets-manifest.json"));

for (const asset of manifest.assets ?? []) {
  const source = asset.absoluteSource ?? path.join(root, asset.source);
  const target = path.join(assetsDir, asset.relativePath);
  await ensureFile(source, `Missing native asset ${asset.key}: ${source}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  if (asset.mode) {
    await fs.chmod(target, asset.mode);
  }
}

await writePlatformPackageStub(assetsDir, manifest.platformPackage);
await writeSqliteStub(assetsDir);
await fs.writeFile(path.join(resourceDir, ".gitkeep"), "", "utf8");

process.stdout.write(`Packaged daemon resources to ${path.relative(root, resourceDir)}\n`);

async function ensureFile(filePath, message) {
  try {
    await fs.access(filePath, constants.R_OK);
  } catch {
    throw new Error(message);
  }
}

async function writePlatformPackageStub(runtimeDir, platformPackage) {
  if (!platformPackage) {
    return;
  }
  const packageDir = path.join(runtimeDir, "node_modules", platformPackage);
  const binDir = path.join(packageDir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: platformPackage, version: "0.0.0-desktop", private: true }, null, 2),
    "utf8",
  );
  const suffix = process.platform === "win32" ? ".exe" : "";
  await copyExecutable(path.join(runtimeDir, "bin", `rg${suffix}`), path.join(binDir, `rg${suffix}`));
  await copyExecutable(
    path.join(runtimeDir, "bin", `cursorsandbox${suffix}`),
    path.join(binDir, `cursorsandbox${suffix}`),
  );
}

async function writeSqliteStub(runtimeDir) {
  const sqliteRoot = path.join(runtimeDir, "node_modules/sqlite3");
  const libDir = path.join(sqliteRoot, "lib");
  await fs.mkdir(libDir, { recursive: true });
  await fs.writeFile(
    path.join(libDir, "sqlite3.js"),
    [
      "const path = require('node:path');",
      "const binding = path.join(__dirname, '..', 'build', 'Release', 'node_sqlite3.node');",
      "module.exports = require(binding);",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(sqliteRoot, "package.json"),
    JSON.stringify({ name: "sqlite3", version: "0.0.0-desktop", main: "lib/sqlite3.js" }, null, 2),
    "utf8",
  );
}

async function copyExecutable(source, target) {
  await ensureFile(source, `Missing packaged binary asset: ${source}`);
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o755);
}
