import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { ApmDaemonServer } from "../src/daemon/server.js";
import { ensureHttpToken, resolveApmHttpTokenPath } from "../src/utils/apm-home.js";

test("http health and runs api", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-http-test-"));
  const socketPath = path.join(root, "apm.sock");
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  await fs.writeFile(
    path.join(root, "config.json"),
    `${JSON.stringify({ cursorApiKey: "", http: { enabled: true, host: "127.0.0.1", port: 0 } }, null, 2)}\n`,
    "utf8",
  );

  const server = new ApmDaemonServer({ workspaceRoot: root, socketPath });
  await server.start();

  const token = (await fs.readFile(resolveApmHttpTokenPath(root), "utf8")).trim();
  const httpInfo = server.getHttpInfo();
  assert.ok(httpInfo.baseUrl);
  const baseUrl = httpInfo.baseUrl;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean };
    assert.equal(healthBody.ok, true);

    const catalogRes = await fetch(`${baseUrl}/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(catalogRes.status, 200);
    const catalog = (await catalogRes.json()) as { entries: unknown[] };
    assert.ok(Array.isArray(catalog.entries));

    const runRes = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entryName: "missing", params: {}, detach: true }),
    });
    assert.equal(runRes.status, 201);
    const { runId } = (await runRes.json()) as { runId: string };
    assert.ok(runId.length > 0);

    let done = false;
    for (let i = 0; i < 30; i += 1) {
      const getRes = await fetch(`${baseUrl}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await getRes.json()) as { run: { status: string } };
      if (body.run.status === "failed" || body.run.status === "finished") {
        done = true;
        break;
      }
      await sleep(100);
    }
    assert.equal(done, true);

    const logsRes = await fetch(`${baseUrl}/runs/${runId}/logs?fromSeq=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(logsRes.status, 200);
    const logs = (await logsRes.json()) as { events: unknown[] };
    assert.ok(logs.events.length > 0);
  } finally {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
