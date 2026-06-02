import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyHistory, interpolateText, pushHistory } from "../src/templating/interpolate.js";

test("interpolate resolves variable and latest history", () => {
  const history = createEmptyHistory();
  pushHistory(history, "stage_a", "abc", "first");
  pushHistory(history, "stage_a", "abc", "second");
  const output = interpolateText("v={v1}, h={abc}", {
    variables: { v1: "hello" },
    history,
  });
  assert.equal(output, "v=hello, h=second");
});

test("interpolate supports stage and index references", () => {
  const history = createEmptyHistory();
  pushHistory(history, "s1", "abc", "x0");
  pushHistory(history, "s1", "abc", "x1");
  pushHistory(history, "s2", "abc", "y0");
  const output = interpolateText("{abc[0]}|{abc[-1]}|{s1.abc[1]}", {
    variables: {},
    history,
  });
  assert.equal(output, "x0|y0|x1");
});
