#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";

const root = process.cwd();
const platformTag = `${process.platform}-${process.arch}`;
const suffix = process.platform === "win32" ? ".exe" : "";

const apmBin = path.join(root, "dist", "bin", `apm-${platformTag}${suffix}`);
const daemonBin = path.join(root, "dist", "bin", `apm-daemon-${platformTag}${suffix}`);

await ensureExecutable(apmBin);
await ensureExecutable(daemonBin);

const apiKey = resolveApiKey();
if (!apiKey) {
  process.stdout.write("SEA smoke skipped: CURSOR_API_KEY is not set and ~/.apm/config.json has no cursorApiKey.\n");
  process.exit(0);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apm-sea-smoke-"));
const socketPath = path.join(tempDir, "apm.sock");
const daemon = spawn(daemonBin, ["--socket", socketPath], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    CURSOR_API_KEY: apiKey,
  },
});

let daemonStdErr = "";
daemon.stderr?.on("data", (chunk) => {
  daemonStdErr += chunk.toString("utf8");
});

try {
  await waitForSocket(socketPath, 15000);
  const runResult = spawnSync(
    apmBin,
    ["run", "test_local", "-d", "-p", "task=sea-smoke", "--socket", socketPath],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_API_KEY: apiKey,
      },
    },
  );
  if (runResult.status !== 0) {
    throw new Error(`SEA run failed: ${runResult.stderr || runResult.stdout}`);
  }
  const runId = runResult.stdout.trim().split("\n")[0]?.trim() ?? "";
  if (!runId) {
    throw new Error("SEA run did not return runId.");
  }

  const deadline = Date.now() + 300_000;
  let finalStatus = "";
  while (Date.now() < deadline) {
    const ps = spawnSync(apmBin, ["ps", "-a", "--socket", socketPath], {
      cwd: root,
      encoding: "utf8",
    });
    const line = ps.stdout.split("\n").find((entry) => entry.includes(runId));
    if (line) {
      finalStatus = line.split(/\s+/)[1] ?? "";
      if (finalStatus === "finished" || finalStatus === "failed") {
        break;
      }
    }
    await sleep(3000);
  }

  const logs = spawnSync(apmBin, ["logs", runId, "--socket", socketPath], {
    cwd: root,
    encoding: "utf8",
  });
  const logText = `${logs.stdout}\n${logs.stderr}`;
  if (logText.includes("Failed to load @cursor/sdk")) {
    throw new Error("SEA daemon failed to load @cursor/sdk.");
  }
  if (finalStatus !== "finished") {
    throw new Error(`SEA workflow did not finish successfully. status=${finalStatus || "unknown"}`);
  }
} finally {
  daemon.kill("SIGTERM");
  await fs.rm(tempDir, { recursive: true, force: true });
}

process.stdout.write("SEA smoke test passed.\n");

async function ensureExecutable(filePath) {
  await fs.access(filePath);
}

async function waitForSocket(socketPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.access(socketPath);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Timed out waiting for SEA daemon socket. stderr=${daemonStdErr}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveApiKey() {
  if (process.env.CURSOR_API_KEY) {
    return process.env.CURSOR_API_KEY;
  }
  try {
    const configPath = path.join(os.homedir(), ".apm", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof config.cursorApiKey === "string" ? config.cursorApiKey : undefined;
  } catch {
    return undefined;
  }
}
