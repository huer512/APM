import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { formatEvent, formatEvents } from "../src/logging/format-events.js";
import { RunStore } from "../src/state/run-store.js";
import type { ApmEventInput } from "../src/types/events.js";

test("RunStore appendEvent assigns monotonic seq", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-event-store-"));
  const store = new RunStore(path.join(root, "state"));
  await store.init();

  const first = await store.appendEvent("run1", baseEvent({ kind: "run", data: { action: "start" } }));
  const second = await store.appendEvent("run1", baseEvent({ kind: "stage", stage: "a", data: { action: "enter" } }));

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);

  const all = await store.readEvents("run1", 0);
  assert.equal(all.length, 2);
  assert.equal(all[0]?.kind, "run");
  assert.equal(all[1]?.stage, "a");
});

test("RunStore readEvents supports fromSeq and kind filter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-event-store-"));
  const store = new RunStore(path.join(root, "state"));
  await store.init();

  await store.appendEvent("run1", baseEvent({ kind: "run", data: { action: "start" } }));
  await store.appendEvent("run1", baseEvent({ kind: "tool", data: { name: "shell", status: "running" } }));
  await store.appendEvent("run1", baseEvent({ kind: "prompt", data: { action: "started" } }));

  const afterFirst = await store.readEvents("run1", 1);
  assert.equal(afterFirst.length, 2);

  const tools = await store.readEvents("run1", 0, undefined, "tool");
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.kind, "tool");
});

test("formatEvents renders tool and stage lines", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-event-store-"));
  const store = new RunStore(path.join(root, "state"));
  await store.init();

  await store.appendEvent("run1", baseEvent({
    kind: "tool",
    data: { name: "read", status: "completed", result: "ok" },
  }));
  await store.appendEvent("run1", baseEvent({
    kind: "stage",
    stage: "plan",
    data: { action: "enter" },
  }));

  const text = await store.readLogs("run1");
  assert.match(text, /\[TOOL\] read completed/);
  assert.match(text, /\[STAGE\] Enter plan/);
  assert.equal(formatEvent((await store.readEvents("run1", 0))[0]!), formatEvents(await store.readEvents("run1", 0)).split("\n")[0]);
});

test("RunStore salvages concatenated corrupt runs.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-event-store-"));
  const stateDir = path.join(root, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const runsFile = path.join(stateDir, "runs.json");
  const first = JSON.stringify({ runs: [{ id: "run-a", createdAt: "2026-01-01T00:00:00.000Z" }] }, null, 2);
  const second = JSON.stringify({ runs: [{ id: "run-b", createdAt: "2026-01-02T00:00:00.000Z" }] }, null, 2);
  await fs.writeFile(runsFile, `${first}${second}`, "utf8");

  const store = new RunStore(stateDir);
  const runs = await store.listRuns(true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, "run-a");

  const repaired = await fs.readFile(runsFile, "utf8");
  assert.doesNotThrow(() => JSON.parse(repaired));
});

test("RunStore serializes concurrent payload updates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-event-store-"));
  const store = new RunStore(path.join(root, "state"));
  await store.init();

  const now = new Date().toISOString();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.createRun({
        id: `run-${index}`,
        entryName: "demo",
        hostName: "local",
        status: "running",
        createdAt: now,
        updatedAt: now,
        attachMode: false,
        waitingForNext: false,
        activeBatch: [],
        variables: {},
        promptHistory: [],
        messageHistory: [],
      }),
    ),
  );

  const runs = await store.listRuns(true);
  assert.equal(runs.length, 20);
  const raw = await fs.readFile(path.join(root, "state", "runs.json"), "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
});

function baseEvent(input: Partial<ApmEventInput>): ApmEventInput {
  return {
    runId: "run1",
    level: "info",
    kind: "run",
    data: {},
    ...input,
  };
}
