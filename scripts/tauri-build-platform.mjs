#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const bundlesByPlatform = {
  darwin: "dmg",
  win32: "nsis",
  linux: "deb,rpm",
};

const bundles = process.env.TAURI_BUNDLES ?? bundlesByPlatform[process.platform];
if (!bundles) {
  throw new Error(`Unsupported desktop build platform: ${process.platform}`);
}

const result = spawnSync(
  "npm",
  ["run", "tauri:build", "--workspace=apm-desktop", "--", "--bundles", bundles],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
