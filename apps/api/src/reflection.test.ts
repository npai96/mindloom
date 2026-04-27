import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConceptSuggestionCandidate,
  buildConceptSuggestionCandidates,
  buildQuizQuestions,
  evaluateReflection,
} from "./services/reflection.js";

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

test("buildConceptSuggestionCandidates includes approval evidence", () => {
  const candidates = buildConceptSuggestionCandidates({
    id: "draft-2",
    status: "saved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preview: {
      title: "Attention rituals for deep work",
      excerpt: "Calendar constraints and deep work rituals protect attention.",
      domain: "manual",
      mediaType: "note",
    },
    reflection:
      "I saved this because attention rituals help me protect the mornings where my best work happens.",
    evaluation: undefined,
  });

  assert.ok(candidates.length >= 2);
  assert.ok(candidates[0]?.evidence?.reason);
  assert.ok(candidates.some((candidate) => candidate.evidence?.reflectionPhrase));
});

test("buildQuizQuestions can prioritize graph-rich weak entries", () => {
  const now = new Date().toISOString();
  const questions = buildQuizQuestions(
    [
      {
        id: "draft-strong",
        status: "saved",
        createdAt: now,
        updatedAt: now,
        preview: {
          title: "Fresh but isolated",
          excerpt: "",
          domain: "manual",
          mediaType: "note",
        },
        reflection: "This matters because it is useful.",
      },
      {
        id: "draft-weak",
        status: "saved",
        createdAt: now,
        updatedAt: now,
        preview: {
          title: "Nervous system safety",
          excerpt: "",
          domain: "manual",
          mediaType: "note",
        },
        reflection: "This matters because safety signals guide better decisions.",
      },
    ],
    (draftId) => (draftId === "draft-weak" ? 0 : 3),
    (draftId) =>
      draftId === "draft-weak"
        ? { concepts: ["Safety Signals", "Nervous System"], edgeCount: 4 }
        : { concepts: [], edgeCount: 0 },
  );

  assert.equal(questions[0]?.draftId, "draft-weak");
  assert.equal(questions[0]?.conceptHint, "Safety Signals");
});
