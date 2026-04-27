import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "actually-learn-store-"));
process.env.APP_DB_PATH = join(tempDir, "test.sqlite");

const { createDraftRecord, store } = await import("./services/store.js");

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("store persists drafts and stats", () => {
  const session = store.createSession("session-a");
  assert.equal(session.sessionId, "session-a");

  const draft = createDraftRecord("session-a", {
    id: "draft-1",
    status: "draft",
    preview: {
      title: "A note",
      excerpt: "Testing",
      domain: "manual",
      mediaType: "note",
    },
  });
  store.createDraft(draft);

  const drafts = store.listDrafts("session-a");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.id, "draft-1");
  assert.equal(store.getStats("session-a").savedCount, 0);
});

test("store tracks commits and concept approvals", () => {
  store.createSession("session-b");
  store.createDraft(
    createDraftRecord("session-b", {
      id: "draft-2",
      status: "approved_for_save",
      preview: {
        title: "Saved item",
        excerpt: "Excerpt",
        domain: "example.com",
        mediaType: "article",
      },
    }),
  );

  store.commitDraft("session-b", {
    draftId: "draft-2",
    mediaNodeId: "media-1",
    reflectionNodeId: "reflection-1",
    savedAt: new Date().toISOString(),
  });
  store.saveConceptSuggestion({
    id: "concept-suggestion-1",
    label: "testing",
    rationale: "Useful concept",
    sourceDraftId: "draft-2",
    approved: false,
    relatedConceptLabels: ["article"],
  });
  store.approveConceptSuggestion("concept-suggestion-1", "session-b");

  assert.equal(store.getStats("session-b").savedCount, 1);
  assert.equal(store.listConceptSuggestions("session-b")[0]?.approved, true);
  assert.equal(store.getSavedArtifact("draft-2")?.mediaNodeId, "media-1");
});

test("store updates editable concept suggestions before approval", () => {
  store.createSession("session-c");
  store.createDraft(
    createDraftRecord("session-c", {
      id: "draft-3",
      status: "saved",
      preview: {
        title: "A saved note",
        excerpt: "Excerpt",
        domain: "manual",
        mediaType: "note",
      },
    }),
  );

  store.saveConceptSuggestion({
    id: "concept-suggestion-2",
    label: "Personal insight",
    rationale: "Initial rationale",
    sourceDraftId: "draft-3",
    approved: false,
    relatedConceptLabels: ["note"],
  });

  const updated = store.updateConceptSuggestion("concept-suggestion-2", "session-c", {
    label: "Nervous System Safety",
    rationale: "A sharper theme worth keeping.",
    relatedConceptLabels: ["physiology", "relationship"],
  });

  assert.equal(updated?.label, "Nervous System Safety");
  assert.equal(updated?.rationale, "A sharper theme worth keeping.");
  assert.deepEqual(updated?.relatedConceptLabels, ["physiology", "relationship"]);
});

test("store can find existing concept nodes by label", () => {
  store.addGraphNode({
    id: "concept-node-1",
    label: "Nervous System Safety",
    kind: "concept",
  });

  const existing = store.findConceptNodeByLabel("nervous system safety");

  assert.equal(existing?.id, "concept-node-1");
});
