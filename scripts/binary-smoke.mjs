#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

const root = process.cwd();
const platformTag = `${process.platform}-${process.arch}`;
const suffix = process.platform === "win32" ? ".exe" : "";

const apmBin = path.join(root, "dist", "bin", `apm-${platformTag}${suffix}`);
const daemonBin = path.join(root, "dist", "bin", `apm-daemon-${platformTag}${suffix}`);

await ensureExecutable(apmBin);
await ensureExecutable(daemonBin);

assertHelp(apmBin, ["--help"], "Usage: apm");
assertHelp(daemonBin, ["--help"], "Usage: apm-daemon");
assertHelp(apmBin, ["run", "--help"], "run");
assertHelp(apmBin, ["run", "--help"], "--attach");
assertHelp(apmBin, ["attach", "--help"], "attach");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apm-bin-smoke-"));
const apmHomeDir = path.join(tempDir, "apm-home");
const socketPath = path.join(tempDir, "apm.sock");
await fs.mkdir(apmHomeDir, { recursive: true });

const daemonEnv = {
  ...process.env,
  APM_HOME: apmHomeDir,
};

const daemon = spawn(daemonBin, ["--socket", socketPath], {
  cwd: root,
  env: daemonEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let daemonStdErr = "";
daemon.stderr?.on("data", (chunk) => {
  daemonStdErr += chunk.toString("utf8");
});

try {
  await waitForSocket(socketPath, 8000);
  const runResult = spawnSync(apmBin, ["run", "missing_entry", "-d", "--socket", socketPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (runResult.status !== 0) {
    throw new Error(`Binary run command failed: ${runResult.stderr || runResult.stdout}`);
  }
  const runId = runResult.stdout.trim();
  if (!runId) {
    throw new Error("Binary run did not return runId.");
  }

  const ps = spawnSync(apmBin, ["ps", "-a", "--socket", socketPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (ps.status !== 0) {
    throw new Error(`Binary ps failed: ${ps.stderr || ps.stdout}`);
  }
  if (!ps.stdout.includes(runId)) {
    throw new Error(`Binary ps output missing run id ${runId}.`);
  }
} finally {
  daemon.kill("SIGTERM");
  await fs.rm(tempDir, { recursive: true, force: true });
}

process.stdout.write("Binary smoke test passed.\n");

function assertHelp(binPath, args, expectedToken) {
  const out = spawnSync(binPath, args, { cwd: root, encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(`Help command failed: ${binPath} ${args.join(" ")} => ${out.stderr || out.stdout}`);
  }
  const text = `${out.stdout}\n${out.stderr}`;
  if (!text.includes(expectedToken)) {
    throw new Error(`Help output does not contain "${expectedToken}" for command ${args.join(" ")}`);
  }
}

async function ensureExecutable(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing binary ${filePath}. Run \`npm run build:bin\` first.`);
  }
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
  throw new Error(`Timed out waiting for daemon socket at ${socketPath}. stderr=${daemonStdErr}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
