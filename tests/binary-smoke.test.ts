import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";

test("binary smoke script exists and is runnable", async (t) => {
  const scriptPath = path.join(process.cwd(), "scripts", "binary-smoke.mjs");
  await fs.access(scriptPath);

  const platformTag = `${process.platform}-${process.arch}`;
  const suffix = process.platform === "win32" ? ".exe" : "";
  const apmBin = path.join(process.cwd(), "dist", "bin", `apm-${platformTag}${suffix}`);

  try {
    await fs.access(apmBin);
  } catch {
    t.skip("Binary artifacts are not built for current platform.");
    return;
  }

  const result = spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Binary smoke test passed/);
});

test("sea smoke script skips or passes", async (t) => {
  const scriptPath = path.join(process.cwd(), "scripts", "sea-smoke.mjs");
  await fs.access(scriptPath);

  const platformTag = `${process.platform}-${process.arch}`;
  const suffix = process.platform === "win32" ? ".exe" : "";
  const daemonBin = path.join(process.cwd(), "dist", "bin", `apm-daemon-${platformTag}${suffix}`);

  try {
    await fs.access(daemonBin);
  } catch {
    t.skip("Binary artifacts are not built for current platform.");
    return;
  }

  if (!process.env.APM_RUN_SEA_SMOKE) {
    t.skip("Set APM_RUN_SEA_SMOKE=1 to run SEA agent integration smoke.");
    return;
  }

  const result = spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SEA smoke test passed|SEA smoke skipped/);
});
