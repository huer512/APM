import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { resolveApmHomeDir } from "./apm-home.js";

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "linux-x64": "@cursor/sdk-linux-x64",
  "linux-arm64": "@cursor/sdk-linux-arm64",
  "darwin-x64": "@cursor/sdk-darwin-x64",
  "darwin-arm64": "@cursor/sdk-darwin-arm64",
  "win32-x64": "@cursor/sdk-win32-x64",
};

interface AssetManifestEntry {
  key: string;
  relativePath: string;
  mode?: number;
}

interface AssetsManifest {
  platform: string;
  arch: string;
  platformPackage: string;
  assets: AssetManifestEntry[];
}

let bootstrapped = false;

export function resolvePlatformPackage(platformKey: string): string | undefined {
  return PLATFORM_PACKAGE_BY_TARGET[platformKey];
}

export function bootstrapSeaRuntime(): string | undefined {
  if (bootstrapped) {
    return process.env.APM_DAEMON_RUNTIME_DIR ?? process.env.APM_SEA_RUNTIME_DIR;
  }

  const packagedRuntimeDir = process.env.APM_DAEMON_RUNTIME_DIR?.trim();
  if (packagedRuntimeDir) {
    const runtimeDir = path.resolve(packagedRuntimeDir);
    process.env.APM_DAEMON_RUNTIME_DIR = runtimeDir;
    process.env.APM_SEA_RUNTIME_DIR = runtimeDir;
    patchModuleResolution(runtimeDir);
    appendPath(path.join(runtimeDir, "bin"));
    bootstrapped = true;
    return runtimeDir;
  }

  let isSea = false;
  try {
    const sea = require("node:sea") as typeof import("node:sea");
    isSea = sea.isSea();
    if (!isSea) {
      return undefined;
    }
    const runtimeDir = materializeSeaAssets(sea);
    patchModuleResolution(runtimeDir);
    process.env.APM_SEA_RUNTIME_DIR = runtimeDir;
    appendPath(path.join(runtimeDir, "bin"));
    bootstrapped = true;
    return runtimeDir;
  } catch {
    return undefined;
  }
}

function materializeSeaAssets(sea: typeof import("node:sea")): string {
  const platformKey = `${process.platform}-${process.arch}`;
  const runtimeDir = path.join(resolveApmHomeDir(), "runtime", platformKey);
  mkdirSync(runtimeDir, { recursive: true });

  const manifest = readManifestFromEnv();
  for (const asset of manifest.assets) {
    const targetPath = path.join(runtimeDir, asset.relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    if (existsSync(targetPath)) {
      continue;
    }
    const data = sea.getAsset(asset.key);
    writeFileSync(targetPath, Buffer.from(data));
    if (asset.mode) {
      chmodSync(targetPath, asset.mode);
    }
  }

  writePlatformPackageStub(runtimeDir, manifest.platformPackage);
  return runtimeDir;
}

function readManifestFromEnv(): AssetsManifest {
  const raw = process.env.APM_SEA_ASSETS_MANIFEST;
  if (!raw) {
    return defaultManifest();
  }
  const parsed = JSON.parse(raw) as AssetsManifest | string;
  if (typeof parsed === "string") {
    return JSON.parse(parsed) as AssetsManifest;
  }
  return parsed;
}

function defaultManifest(): AssetsManifest {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[platformKey];
  if (!platformPackage) {
    throw new Error(`Unsupported SEA platform: ${platformKey}`);
  }
  const binSuffix = process.platform === "win32" ? ".exe" : "";
  return {
    platform: process.platform,
    arch: process.arch,
    platformPackage,
    assets: [
      { key: "rg", relativePath: `bin/rg${binSuffix}`, mode: 0o755 },
      { key: "cursorsandbox", relativePath: `bin/cursorsandbox${binSuffix}`, mode: 0o755 },
      { key: "sqlite3.node", relativePath: "node_modules/sqlite3/build/Release/node_sqlite3.node" },
    ],
  };
}

function writePlatformPackageStub(runtimeDir: string, platformPackage: string): void {
  const packageDir = path.join(runtimeDir, "node_modules", platformPackage);
  mkdirSync(path.join(packageDir, "bin"), { recursive: true });
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: platformPackage, version: "0.0.0-sea", private: true }, null, 2),
      "utf8",
    );
  }
  const binSuffix = process.platform === "win32" ? ".exe" : "";
  linkIfMissing(path.join(packageDir, "bin", `rg${binSuffix}`), path.join(runtimeDir, "bin", `rg${binSuffix}`));
  linkIfMissing(
    path.join(packageDir, "bin", `cursorsandbox${binSuffix}`),
    path.join(runtimeDir, "bin", `cursorsandbox${binSuffix}`),
  );
}

function linkIfMissing(linkPath: string, targetPath: string): void {
  if (existsSync(linkPath)) {
    return;
  }
  try {
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    symlinkSync(targetPath, linkPath);
  } catch {
    const { copyFileSync } = require("node:fs") as typeof import("node:fs");
    copyFileSync(targetPath, linkPath);
    chmodSync(linkPath, 0o755);
  }
}

function patchModuleResolution(runtimeDir: string): void {
  const nodeModulesRoot = path.join(runtimeDir, "node_modules");
  const moduleInternal = Module as typeof Module & {
    _resolveFilename: (
      request: string,
      parent: Module | null,
      isMain: boolean,
      options?: unknown,
    ) => string;
    _initPaths: () => void;
  };
  const originalResolve = moduleInternal._resolveFilename;
  moduleInternal._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (request === "@cursor/sdk") {
      return path.join(nodeModulesRoot, "@cursor/sdk/dist/cjs/index.js");
    }
    if (request === "sqlite3" || request.startsWith("sqlite3/")) {
      return path.join(nodeModulesRoot, "sqlite3", "lib", "sqlite3.js");
    }
    if (request.startsWith("@cursor/sdk-")) {
      const candidate = path.join(nodeModulesRoot, request);
      if (existsSync(path.join(candidate, "package.json"))) {
        return candidate;
      }
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };

  writeSqliteStub(nodeModulesRoot);
  const currentNodePath = process.env.NODE_PATH ?? "";
  process.env.NODE_PATH = [nodeModulesRoot, currentNodePath].filter(Boolean).join(path.delimiter);
  moduleInternal._initPaths();
}

function writeSqliteStub(nodeModulesRoot: string): void {
  const sqliteRoot = path.join(nodeModulesRoot, "sqlite3");
  const libDir = path.join(sqliteRoot, "lib");
  const bindingDir = path.join(sqliteRoot, "build", "Release");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(bindingDir, { recursive: true });

  const bindingPath = path.join(bindingDir, "node_sqlite3.node");
  const extractedBinding = path.join(
    resolveApmHomeDir(),
    "runtime",
    `${process.platform}-${process.arch}`,
    "node_modules/sqlite3/build/Release/node_sqlite3.node",
  );
  if (!existsSync(bindingPath) && existsSync(extractedBinding)) {
    linkIfMissing(bindingPath, extractedBinding);
  }

  const sqliteJsPath = path.join(libDir, "sqlite3.js");
  if (!existsSync(sqliteJsPath)) {
    writeFileSync(
      sqliteJsPath,
      [
        "const path = require('node:path');",
        "const binding = path.join(__dirname, '..', 'build', 'Release', 'node_sqlite3.node');",
        "module.exports = require(binding);",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  const packageJsonPath = path.join(sqliteRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "sqlite3", version: "0.0.0-sea", main: "lib/sqlite3.js" }, null, 2),
      "utf8",
    );
  }
}

function appendPath(entry: string): void {
  const current = process.env.PATH ?? "";
  if (current.split(path.delimiter).includes(entry)) {
    return;
  }
  process.env.PATH = [entry, current].filter(Boolean).join(path.delimiter);
}

export function resolveSeaRuntimeDir(): string | undefined {
  return process.env.APM_DAEMON_RUNTIME_DIR ?? process.env.APM_SEA_RUNTIME_DIR;
}

export function isRunningInSea(): boolean {
  try {
    const sea = require("node:sea") as typeof import("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}

if (process.env.APM_DAEMON_RUNTIME_DIR || isRunningInSea()) {
  bootstrapSeaRuntime();
}
