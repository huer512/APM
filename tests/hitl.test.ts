import test from "node:test";
import assert from "node:assert/strict";
import { HitlController } from "../src/engine/hitl-controller.js";

test("hitl waits and releases by batch", async () => {
  const hitl = new HitlController();
  const runId = "run-hitl";
  let released = false;

  const waitPromise = hitl.waitForBatch(runId, "batch-a").then(() => {
    released = true;
  });

  await sleep(20);
  assert.equal(released, false);

  hitl.moveBatch(runId, "batch-b");
  await sleep(20);
  assert.equal(released, false);

  hitl.moveBatch(runId, "batch-a");
  await waitPromise;
  assert.equal(released, true);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
