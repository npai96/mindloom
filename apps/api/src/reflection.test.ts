import test from "node:test";
import assert from "node:assert/strict";

import { evaluateReflection } from "./services/reflection.js";

test("evaluateReflection accepts thoughtful reflections", () => {
  const result = evaluateReflection(
    "I saved this because it challenges how I think about online learning and gives me a concrete idea to test this week.",
  );

  assert.equal(result.accepted, true);
  assert.ok(result.score >= 0.65);
});

test("evaluateReflection rejects shallow summaries", () => {
  const result = evaluateReflection("This is about AI and learning.");

  assert.equal(result.accepted, false);
  assert.match(result.feedback, /why this matters to you/i);
});
