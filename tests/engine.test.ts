import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowEngine } from "../src/engine/workflow-engine.js";
import type { ApmEvent, ApmEventInput } from "../src/types/events.js";
import type { RunRecord } from "../src/types.js";
import type { WorkflowBundle } from "../src/config/loaders.js";

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
    this.run.lastEventSeq = this.seq;
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
  public outputs: string[] = [];

  public async runPrompt(_sessionKey: string, _prompt: unknown, rendered: string): Promise<string> {
    const out = `OUT:${rendered}`;
    this.outputs.push(out);
    return out;
  }

  public async sendFollowUp(): Promise<string> {
    return "FOLLOWUP";
  }
}

class FakeHitl {
  public attached = false;
  public registerMessageHandler(): void {}
  public isAttached(): boolean {
    return this.attached;
  }
  public async waitForNext(): Promise<void> {}
  public async waitForBatch(): Promise<void> {}
  public moveBatch(): void {}
}

test("engine executes prompts and writes history", async () => {
  const run: RunRecord = {
    id: "run1",
    entryName: "demo",
    hostName: "local",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachMode: false,
    waitingForNext: false,
    activeBatch: [],
    variables: { name: "alice" },
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
      [
        "p1",
        {
          name: "p1",
          path: "prompts/p1.md",
          model: "auto",
          metadata: {},
          body: "hello {name}",
        },
      ],
    ]),
  };

  const fakeStore = new FakeStore(run);
  const fakeRunner = new FakeRunner();
  const engine = new WorkflowEngine({
    store: fakeStore as any,
    hostExecutor: new FakeHostExecutor() as any,
    runner: fakeRunner as any,
    hitl: new FakeHitl() as any,
  });

  await engine.execute(bundle, run);

  assert.equal(fakeStore.run.promptHistory.length, 1);
  assert.match(fakeStore.run.promptHistory[0]?.output ?? "", /^OUT:hello alice$/);
  assert.equal(fakeStore.run.status, "finished");
  assert.ok(fakeStore.events.some((event) => event.kind === "prompt"));
});

test("engine deduplicates merge stage after parallel branches", async () => {
  const run: RunRecord = {
    id: "run2",
    entryName: "demo",
    hostName: "local",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachMode: false,
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
      entry: "a",
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
      ["a", { name: "a", path: "stages/a.md", prompts: ["pa"], nextStages: ["b", "c"], rawBody: "" }],
      ["b", { name: "b", path: "stages/b.md", prompts: ["pb"], nextStages: ["d"], rawBody: "" }],
      ["c", { name: "c", path: "stages/c.md", prompts: ["pc"], nextStages: ["d"], rawBody: "" }],
      ["d", { name: "d", path: "stages/d.md", prompts: ["pd"], nextStages: [], rawBody: "" }],
    ]),
    prompts: new Map([
      ["pa", { name: "pa", path: "prompts/pa.md", model: "auto", metadata: {}, body: "A" }],
      ["pb", { name: "pb", path: "prompts/pb.md", model: "auto", metadata: {}, body: "B" }],
      ["pc", { name: "pc", path: "prompts/pc.md", model: "auto", metadata: {}, body: "C" }],
      ["pd", { name: "pd", path: "prompts/pd.md", model: "auto", metadata: {}, body: "D" }],
    ]),
  };

  const fakeStore = new FakeStore(run);
  const fakeRunner = new FakeRunner();
  const engine = new WorkflowEngine({
    store: fakeStore as any,
    hostExecutor: new FakeHostExecutor() as any,
    runner: fakeRunner as any,
    hitl: new FakeHitl() as any,
  });
  await engine.execute(bundle, run);

  const dExecutions = fakeStore.run.promptHistory.filter((item) => item.stage === "d" && item.prompt === "pd");
  assert.equal(dExecutions.length, 1);
});
