import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { ApmDaemonServer } from "../src/daemon/server.js";
import { rpcCall } from "../src/daemon/rpc.js";
import type { ApmEvent } from "../src/types/events.js";

test("daemon run returns id and watch reaches done", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-daemon-test-"));
  const socketPath = path.join(root, "apm.sock");
  await fs.writeFile(
    path.join(root, "config.json"),
    `${JSON.stringify({ cursorApiKey: "", http: { enabled: false } }, null, 2)}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  const server = new ApmDaemonServer({
    workspaceRoot: root,
    socketPath,
  });
  await server.start();

  try {
    const start = await rpcCall<{ runId: string }>(socketPath, "run", {
      entryName: "missing-entry",
      params: {},
      detach: true,
    });
    assert.ok(start.runId.length > 0);

    let fromSeq = 0;
    let done = false;
    let status = "";
    for (let i = 0; i < 20; i += 1) {
      const watch = await rpcCall<{ done: boolean; nextSeq: number; chunk: string; run: { status: string } }>(
        socketPath,
        "run.watch",
        {
          runId: start.runId,
          fromSeq,
        },
      );
      fromSeq = watch.nextSeq;
      done = watch.done;
      status = watch.run.status;
      if (done) {
        break;
      }
      await sleep(100);
    }

    assert.equal(done, true);
    assert.match(status, /failed|finished/);

    const logs = await rpcCall<{ events: ApmEvent[]; text: string }>(socketPath, "logs", {
      runId: start.runId,
      fromSeq: 0,
    });
    assert.ok(Array.isArray(logs.events));
    assert.ok(logs.events.some((event) => event.kind === "run"));
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
