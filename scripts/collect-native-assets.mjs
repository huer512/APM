#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";

const root = process.cwd();

const PLATFORM_PACKAGE_BY_TARGET = {
  "linux-x64": "@cursor/sdk-linux-x64",
  "linux-arm64": "@cursor/sdk-linux-arm64",
  "darwin-x64": "@cursor/sdk-darwin-x64",
  "darwin-arm64": "@cursor/sdk-darwin-arm64",
  "win32-x64": "@cursor/sdk-win32-x64",
};

const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = PLATFORM_PACKAGE_BY_TARGET[platformKey];
if (!platformPackage) {
  throw new Error(`Unsupported platform for native asset collection: ${platformKey}`);
}

const platformRoot = path.join(root, "node_modules", platformPackage);
const sqliteBinding = path.join(root, "node_modules/sqlite3/build/Release/node_sqlite3.node");
const sshCryptoBinding = path.join(
  root,
  "node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node",
);
const cpuFeaturesBinding = path.join(root, "node_modules/cpu-features/build/Release/cpufeatures.node");

const required = [
  { key: "rg", source: path.join(platformRoot, "bin/rg"), relativePath: "bin/rg", mode: 0o755 },
  {
    key: "cursorsandbox",
    source: path.join(platformRoot, "bin/cursorsandbox"),
    relativePath: "bin/cursorsandbox",
    mode: 0o755,
  },
  {
    key: "sqlite3.node",
    source: sqliteBinding,
    relativePath: "node_modules/sqlite3/build/Release/node_sqlite3.node",
  },
];

for (const optional of [
  {
    key: "sshcrypto.node",
    source: sshCryptoBinding,
    relativePath: "node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node",
  },
  {
    key: "cpufeatures.node",
    source: cpuFeaturesBinding,
    relativePath: "node_modules/cpu-features/build/Release/cpufeatures.node",
  },
]) {
  try {
    await fs.access(optional.source);
    required.push(optional);
  } catch {
    // Optional native accelerators for ssh2.
  }
}

const manifestAssets = [];
for (const item of required) {
  try {
    await fs.access(item.source);
  } catch {
    throw new Error(
      `Missing native asset ${item.key} at ${item.source}. Run npm ci on ${platformKey} before building SEA binaries.`,
    );
  }
  manifestAssets.push({
    key: item.key,
    source: path.relative(root, item.source),
    absoluteSource: item.source,
    relativePath: item.relativePath,
    mode: item.mode,
  });
}

const outDir = path.join(root, "dist/bundle");
await fs.mkdir(outDir, { recursive: true });

const manifest = {
  platform: process.platform,
  arch: process.arch,
  platformKey,
  platformPackage,
  assets: manifestAssets,
};

const manifestPath = path.join(outDir, "assets-manifest.json");
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
process.stdout.write(`Wrote ${path.relative(root, manifestPath)} (${manifestAssets.length} assets)\n`);
