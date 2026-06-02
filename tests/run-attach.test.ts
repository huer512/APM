import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { ApmDaemonServer } from "../src/daemon/server.js";
import { rpcCall } from "../src/daemon/rpc.js";
import { runCommand } from "../src/cli/commands/run.js";
import { WorkflowEngine } from "../src/engine/workflow-engine.js";
import { HitlController } from "../src/engine/hitl-controller.js";
import type { RunRecord } from "../src/types.js";
import type { ApmEvent, ApmEventInput } from "../src/types/events.js";
import type { WorkflowBundle } from "../src/config/loaders.js";

test("runCommand rejects --attach together with --detach", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-run-attach-test-"));
  const socketPath = path.join(root, ".apm", "apm.sock");
  const server = new ApmDaemonServer({
    workspaceRoot: root,
    socketPath,
  });
  await server.start();

  try {
    await assert.rejects(
      () => runCommand(socketPath, "missing-entry", [], true, true),
      /--attach cannot be used together with --detach/,
    );
  } finally {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("daemon run with attach sets attachMode before execution starts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apm-run-attach-test-"));
  const socketPath = path.join(root, ".apm", "apm.sock");
  const server = new ApmDaemonServer({
    workspaceRoot: root,
    socketPath,
  });
  await server.start();

  try {
    const start = await rpcCall<{ runId: string }>(socketPath, "run", {
      entryName: "missing-entry",
      params: {},
      detach: false,
      attach: true,
    });
    assert.ok(start.runId.length > 0);

    const snapshot = await rpcCall<{ run: RunRecord }>(socketPath, "attach.snapshot", {
      runId: start.runId,
    });
    assert.equal(snapshot.run.attachMode, true);

    let fromSeq = 0;
    let done = false;
    for (let i = 0; i < 20; i += 1) {
      const watch = await rpcCall<{ done: boolean; nextSeq: number; run: { status: string } }>(
        socketPath,
        "run.watch",
        {
          runId: start.runId,
          fromSeq,
        },
      );
      fromSeq = watch.nextSeq;
      done = watch.done;
      if (done) {
        break;
      }
      await sleep(100);
    }
    assert.equal(done, true);
  } finally {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("engine pauses after batch when hitl is attached", async () => {
  class FakeStore {
    public run: RunRecord;
    public events: ApmEvent[] = [];
    private seq = 0;

    public constructor(run: RunRecord) {
      this.run = run;
    }

    public async updateRun(_runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
      this.run = {
        ...this.run,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      return this.run;
    }

    public async appendEvent(_runId: string, input: ApmEventInput): Promise<ApmEvent> {
      this.seq += 1;
      const event: ApmEvent = {
        v: 1,
        seq: this.seq,
        ts: input.ts ?? new Date().toISOString(),
        runId: input.runId,
        level: input.level,
        kind: input.kind,
        stage: input.stage,
        prompt: input.prompt,
        sessionKey: input.sessionKey,
        sdkRunId: input.sdkRunId,
        data: input.data,
      };
      this.events.push(event);
      return event;
    }

    public async appendPromptHistory(_runId: string, item: RunRecord["promptHistory"][number]): Promise<void> {
      this.run.promptHistory.push(item);
    }

    public async appendMessageHistory(_runId: string, item: RunRecord["messageHistory"][number]): Promise<void> {
      this.run.messageHistory.push(item);
    }

    public async getRun(): Promise<RunRecord> {
      return this.run;
    }
  }

  class FakeHostExecutor {
    public async prepare(): Promise<{ kind: "local"; workspace: string }> {
      return { kind: "local", workspace: process.cwd() };
    }
  }

  class FakeRunner {
    public async runPrompt(): Promise<string> {
      return "OUT";
    }

    public async sendFollowUp(): Promise<string> {
      return "FOLLOWUP";
    }
  }

  const run: RunRecord = {
    id: "run-hitl-pause",
    entryName: "demo",
    hostName: "local",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachMode: true,
    waitingForNext: false,
    activeBatch: [],
    variables: {},
    promptHistory: [],
    messageHistory: [],
  };

  const bundle: WorkflowBundle = {
    rootDir: process.cwd(),
    entry: {
      name: "demo",
      path: "entries/demo.md",
      entry: "stage_a",
      host: "local",
      variables: {},
      description: "",
    },
    host: {
      name: "local",
      path: "hosts/local.md",
      host: "localhost",
      workspace: ".",
    },
    stages: new Map([
      [
        "stage_a",
        {
          name: "stage_a",
          path: "stages/stage_a.md",
          prompts: ["p1"],
          nextStages: [],
          rawBody: "",
        },
      ],
    ]),
    prompts: new Map([
      ["p1", { name: "p1", path: "prompts/p1.md", model: "auto", metadata: {}, body: "A" }],
    ]),
  };

  const fakeStore = new FakeStore(run);
  const hitl = new HitlController();
  hitl.setAttached(run.id, true);

  const engine = new WorkflowEngine({
    store: fakeStore as any,
    hostExecutor: new FakeHostExecutor() as any,
    runner: new FakeRunner() as any,
    hitl,
  });

  const executePromise = engine.execute(bundle, run);
  await sleep(50);
  assert.equal(fakeStore.run.waitingForNext, true);
  assert.equal(fakeStore.run.status, "paused");

  hitl.moveBatch(run.id, "stage_a");
  await executePromise;
  assert.equal(fakeStore.run.status, "finished");
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
