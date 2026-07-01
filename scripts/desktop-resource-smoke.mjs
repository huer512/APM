#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const resourceRoot = path.join(root, "apps/apm-desktop/src-tauri/resources");
const nodePath = path.join(resourceRoot, "runtime", process.platform === "win32" ? "node.exe" : "node");
const daemonBundle = path.join(resourceRoot, "daemon", "apm-daemon.bundle.cjs");
const daemonAssets = path.join(resourceRoot, "daemon", "assets");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apm-desktop-smoke-"));
const apmHome = path.join(tempDir, "apm-home");
const logPath = path.join(tempDir, "daemon.log");
const port = 20_000 + Math.floor(Math.random() * 20_000);

await ensureFile(nodePath);
await ensureFile(daemonBundle);
await fs.mkdir(apmHome, { recursive: true });
await fs.writeFile(
  path.join(apmHome, "config.json"),
  `${JSON.stringify({ http: { enabled: true, host: "127.0.0.1", port } }, null, 2)}\n`,
);

const log = await fs.open(logPath, "a");
const child = spawn(nodePath, [daemonBundle], {
  cwd: path.dirname(daemonBundle),
  env: {
    ...process.env,
    APM_HOME: apmHome,
    APM_DAEMON_RUNTIME_DIR: daemonAssets,
    APM_SEA_RUNTIME_DIR: daemonAssets,
  },
  stdio: ["ignore", log.fd, log.fd],
  windowsHide: true,
});

try {
  const baseUrl = `http://127.0.0.1:${port}/health`;
  await waitForHealth(baseUrl, 12_000);
  process.stdout.write("Desktop packaged daemon smoke passed.\n");
} catch (error) {
  const output = await fs.readFile(logPath, "utf8").catch(() => "");
  throw new Error(`${String(error)}\n--- daemon log ---\n${output}`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await log.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function ensureFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing required packaged resource: ${filePath}`);
  }
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Daemon exited before health check succeeded. exitCode=${child.exitCode}`);
    }
    if (await checkHealth(url)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function checkHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
