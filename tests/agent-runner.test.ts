import test from "node:test";
import assert from "node:assert/strict";
import { AgentRunner } from "../src/engine/agent-runner.js";

test("AgentRunner passes settingSources when skills enabled", async () => {
  let createOptions: Record<string, unknown> | undefined;
  const runner = new AgentRunner({
    apiKey: "cursor_test_key",
    sdkModuleLoader: async () => ({
      Agent: {
        create: async (options: Record<string, unknown>) => {
          createOptions = options;
          return {
            send: async () => createFakeRun([]),
            close: async () => {},
            [Symbol.asyncDispose]: async () => {},
          };
        },
      },
    }),
  });

  await runner.runPrompt(
    "run.stage.prompt",
    {
      name: "prompt",
      path: "prompts/prompt.md",
      model: "auto",
      metadata: { skills: true },
      body: "hello",
    },
    "hello",
    { kind: "local", workspace: process.cwd() },
    {},
  );

  const local = createOptions?.local as Record<string, unknown> | undefined;
  assert.deepEqual(local?.settingSources, ["project"]);
});

test("AgentRunner omits settingSources when skills disabled", async () => {
  let createOptions: Record<string, unknown> | undefined;
  const runner = new AgentRunner({
    apiKey: "cursor_test_key",
    sdkModuleLoader: async () => ({
      Agent: {
        create: async (options: Record<string, unknown>) => {
          createOptions = options;
          return {
            send: async () => createFakeRun([]),
            close: async () => {},
            [Symbol.asyncDispose]: async () => {},
          };
        },
      },
    }),
  });

  await runner.runPrompt(
    "run.stage.prompt",
    {
      name: "prompt",
      path: "prompts/prompt.md",
      model: "auto",
      metadata: {},
      body: "hello",
    },
    "hello",
    { kind: "local", workspace: process.cwd() },
    {},
  );

  const local = createOptions?.local as Record<string, unknown> | undefined;
  assert.equal(local?.settingSources, undefined);
});

test("AgentRunner emits tool events from stream", async () => {
  const events: Array<Record<string, unknown>> = [];
  const runner = new AgentRunner({
    apiKey: "cursor_test_key",
    sdkModuleLoader: async () => ({
      Agent: {
        create: async () => ({
          send: async () =>
            createFakeRun([
              {
                type: "tool_call",
                run_id: "sdk-run-1",
                call_id: "call-1",
                name: "shell",
                status: "running",
                args: { command: "ls" },
              },
              {
                type: "tool_call",
                run_id: "sdk-run-1",
                call_id: "call-1",
                name: "shell",
                status: "completed",
                result: "done",
              },
              {
                type: "assistant",
                message: { content: [{ type: "text", text: "finished" }] },
              },
            ]),
          close: async () => {},
          [Symbol.asyncDispose]: async () => {},
        }),
      },
    }),
  });

  const output = await runner.runPrompt(
    "run.stage.prompt",
    {
      name: "prompt",
      path: "prompts/prompt.md",
      model: "auto",
      metadata: {},
      body: "hello",
    },
    "hello",
    { kind: "local", workspace: process.cwd() },
    {},
    {
      onSdkEvent: async (event) => {
        events.push(event as Record<string, unknown>);
      },
    },
  );

  assert.equal(output, "finished");
  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, "tool");
  assert.equal((events[0]?.data as Record<string, unknown>)?.status, "running");
  assert.equal((events[1]?.data as Record<string, unknown>)?.status, "completed");
});

function createFakeRun(messages: unknown[]) {
  return {
    stream: async function* () {
      for (const message of messages) {
        yield message;
      }
    },
    wait: async () => ({ status: "finished", id: "sdk-run-1", result: "finished" }),
  };
}
