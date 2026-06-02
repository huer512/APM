import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillsEnabled } from "../src/config/skills.js";

test("parseSkillsEnabled accepts common truthy values", () => {
  assert.equal(parseSkillsEnabled({ skills: true }), true);
  assert.equal(parseSkillsEnabled({ skills: "true" }), true);
  assert.equal(parseSkillsEnabled({ skills: "on" }), true);
  assert.equal(parseSkillsEnabled({ skills: "yes" }), true);
  assert.equal(parseSkillsEnabled({ skills: 1 }), true);
});

test("parseSkillsEnabled defaults to false", () => {
  assert.equal(parseSkillsEnabled({}), false);
  assert.equal(parseSkillsEnabled({ skills: false }), false);
  assert.equal(parseSkillsEnabled({ skills: "false" }), false);
});
