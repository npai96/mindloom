import test from "node:test";
import assert from "node:assert/strict";

import type {
  ConceptSuggestion,
  GraphEdgeCandidate,
  GraphSnapshot,
  MediaDraft,
} from "@actually-learn/shared";

import { buildKnowledgeGraph } from "./services/knowledge.js";

function createSavedDraft(id: string, title: string, reflection: string): MediaDraft {
  const now = new Date().toISOString();
  return {
    id,
    status: "saved",
    createdAt: now,
    updatedAt: now,
    preview: {
      title,
      excerpt: "",
      domain: "example.com",
      mediaType: "article",
    },
    reflection,
    evaluation: {
      accepted: true,
      score: 0.9,
      feedback: "Strong reflection.",
      rubric: {
        hasPersonalReason: true,
        hasSpecificity: true,
        avoidsSummaryOnly: true,
      },
    },
  };
}

function buildGraph(
  drafts: MediaDraft[],
  suggestions: ConceptSuggestion[] = [],
  graph: GraphSnapshot = { nodes: [], edges: [] },
  edgeCandidates: GraphEdgeCandidate[] = [],
) {
  return buildKnowledgeGraph({ drafts, suggestions, graph, edgeCandidates });
}

test("buildKnowledgeGraph links entries through distinctive shared concepts", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Luck Engineering",
      "I want to revisit this because it reframes agency as something that can be designed.",
    ),
    createSavedDraft(
      "draft-2",
      "Discipline as Freedom",
      "This matters to me because it sharpens a tension between freedom and structure in my life.",
    ),
  ];

  const suggestions: ConceptSuggestion[] = [
    {
      id: "suggestion-1",
      label: "highagency",
      rationale: "A distinctive thread around agency.",
      sourceDraftId: "draft-1",
      approved: true,
      relatedConceptLabels: [],
    },
    {
      id: "suggestion-2",
      label: "highagency",
      rationale: "A distinctive thread around agency.",
      sourceDraftId: "draft-2",
      approved: true,
      relatedConceptLabels: [],
    },
  ];

  const knowledge = buildGraph(drafts, suggestions);

  assert.equal(knowledge.edges.length, 1);
  assert.match(knowledge.edges[0]?.label ?? "", /highagency/i);
  assert.ok((knowledge.edges[0]?.weight ?? 0) >= 0.26);
});

test("buildKnowledgeGraph does not connect entries only through generic concepts", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Test article",
      "I saved this because it made me more aware of cognitive biases in everyday judgment.",
    ),
    createSavedDraft(
      "draft-2",
      "Freedom belongs to the disciplined",
      "I want to revisit this because it pushes me to think about freedom through constraints.",
    ),
  ];

  const suggestions: ConceptSuggestion[] = [
    {
      id: "suggestion-1",
      label: "Personal insight",
      rationale: "Too broad to anchor the graph.",
      sourceDraftId: "draft-1",
      approved: true,
      relatedConceptLabels: [],
    },
    {
      id: "suggestion-2",
      label: "Personal insight",
      rationale: "Too broad to anchor the graph.",
      sourceDraftId: "draft-2",
      approved: true,
      relatedConceptLabels: [],
    },
  ];

  const knowledge = buildGraph(drafts, suggestions);

  assert.equal(knowledge.edges.length, 0);
});

test("buildKnowledgeGraph can connect entries through meaningful shared language", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Thinking in public",
      "I saved this because writing in public creates accountability and compounds clarity over time.",
    ),
    createSavedDraft(
      "draft-2",
      "Why public writing matters",
      "This matters to me because public writing creates accountability and lets clarity compound.",
    ),
  ];

  const knowledge = buildGraph(drafts);

  assert.equal(knowledge.edges.length, 1);
  assert.match(knowledge.edges[0]?.reasons.join(" ") ?? "", /shared language/i);
});

test("buildKnowledgeGraph normalizes concept spacing before scoring similarity", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Luck Engineering",
      "I saved this because I want to become more agentic in how I design my work.",
    ),
    createSavedDraft(
      "draft-2",
      "Discipline as Freedom",
      "This matters to me because structure can expand agency instead of limiting it.",
    ),
  ];

  const suggestions: ConceptSuggestion[] = [
    {
      id: "suggestion-1",
      label: "highagency",
      rationale: "A compact label.",
      sourceDraftId: "draft-1",
      approved: true,
      relatedConceptLabels: [],
    },
    {
      id: "suggestion-2",
      label: "high agency",
      rationale: "A spaced label for the same idea.",
      sourceDraftId: "draft-2",
      approved: true,
      relatedConceptLabels: [],
    },
  ];

  const knowledge = buildGraph(drafts, suggestions);

  assert.equal(knowledge.edges.length, 1);
  assert.equal(knowledge.nodes[0]?.concepts.length, 1);
  assert.equal(knowledge.nodes[1]?.concepts.length, 1);
});

test("buildKnowledgeGraph prefers cleaner concept labels after normalization", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Keeping score",
      "I want to revisit how scorekeeping shapes my attention.",
    ),
  ];

  const suggestions: ConceptSuggestion[] = [
    {
      id: "suggestion-1",
      label: "mental models",
      rationale: "Plural label.",
      sourceDraftId: "draft-1",
      approved: true,
      relatedConceptLabels: ["mental model"],
    },
  ];

  const knowledge = buildGraph(drafts, suggestions);

  assert.deepEqual(knowledge.nodes[0]?.concepts, ["Mental Model"]);
});

test("buildKnowledgeGraph respects dismissed persisted edge candidates", () => {
  const drafts = [
    createSavedDraft(
      "draft-1",
      "Thinking in public",
      "I saved this because public writing creates accountability and compounds clarity.",
    ),
    createSavedDraft(
      "draft-2",
      "Public writing rituals",
      "This matters because writing in public creates accountability and helps clarity compound.",
    ),
  ];
  const generated = buildGraph(drafts);
  const edge = generated.edges[0];
  assert.ok(edge);

  const knowledge = buildGraph(drafts, [], { nodes: [], edges: [] }, [
    {
      ...edge,
      status: "dismissed",
    },
  ]);

  assert.equal(knowledge.edges.length, 0);
});

test("buildKnowledgeGraph keeps approved persisted edge candidates when weakly regenerated", () => {
  const drafts = [
    createSavedDraft("draft-1", "Safety signals", "I want to remember nervous system safety."),
    createSavedDraft("draft-2", "Calendar design", "This is about protecting attention."),
  ];

  const knowledge = buildGraph(drafts, [], { nodes: [], edges: [] }, [
    {
      id: "draft-1:draft-2",
      from: "draft-1",
      to: "draft-2",
      label: "User-approved connection",
      weight: 0.3,
      reasons: ["Manually approved as a meaningful link."],
      status: "approved",
    },
  ]);

  assert.equal(knowledge.edges.length, 1);
  assert.equal(knowledge.edges[0]?.status, "approved");
  assert.match(knowledge.edges[0]?.label ?? "", /user-approved/i);
});
