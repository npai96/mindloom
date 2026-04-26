import test from "node:test";
import assert from "node:assert/strict";

import { buildConceptSuggestionCandidate, evaluateReflection } from "./services/reflection.js";

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

test("buildConceptSuggestionCandidate derives a specific concept from reflection text", () => {
  const candidate = buildConceptSuggestionCandidate({
    id: "draft-1",
    status: "saved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preview: {
      title: "Love and the nervous system",
      excerpt: "A note about physiology and relationships.",
      domain: "manual",
      mediaType: "note",
    },
    reflection:
      "This matters because my nervous system gives me a better signal than my stories when I am deciding whether someone feels safe.",
    evaluation: undefined,
  });

  assert.match(candidate.label, /Nervous System|Feel Safe|Safe Signal/i);
  assert.ok(candidate.relatedConceptLabels.length >= 1);
});
