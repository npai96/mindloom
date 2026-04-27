import { randomUUID } from "node:crypto";

import { Router } from "express";
import type { Request, Response } from "express";

import {
  relationshipTypes,
  schemaUris,
  type GraphEdge,
  type GraphNode,
  type ConceptSuggestion,
  type MeResponse,
  type MediaDraft,
  type QuizAnswerPayload,
} from "@actually-learn/shared";

import { getEnv } from "../lib/env.js";
import { readJson, sendError } from "../lib/http.js";
import { ParadigmClient } from "../services/paradigm.js";
import {
  buildConceptSuggestionCandidate,
  buildQuizQuestions,
  evaluateReflection,
  generateReflectionPrompts,
  scoreQuizAnswer,
} from "../services/reflection.js";
import { buildKnowledgeGraph } from "../services/knowledge.js";
import { createDraftRecord, store } from "../services/store.js";

const env = getEnv();
const paradigm = new ParadigmClient(env);

type ParadigmNode = {
  id: string;
  title: string;
  schema_uri?: string;
  value_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

type ParadigmRelationship = {
  id?: string;
  from_node_id: string;
  to_node_id: string;
  relationship_type: string;
  context?: string;
};

const trackedRelationshipTypes = new Set<string>([
  relationshipTypes.reflectsOn,
  relationshipTypes.aboutConcept,
  relationshipTypes.relatedTo,
  relationshipTypes.reviewedIn,
]);

function getSessionId(req: Request, res: Response) {
  const sessionId = req.sessionId as string | undefined;
  if (!sessionId) {
    sendError(res, 401, "Missing session");
    return undefined;
  }
  return sessionId;
}

function canHydrateFromPermissions(permissions: Record<string, string[]>) {
  return (
    permissions.nodes?.includes("read") &&
    permissions.relationships?.includes("read")
  );
}

function canCreateNodes(permissions: Record<string, string[]>) {
  return permissions.nodes?.includes("create") ?? false;
}

function canCreateRelationships(permissions: Record<string, string[]>) {
  return permissions.relationships?.includes("create") ?? false;
}

async function syncPermissions(sessionId: string, userId?: string) {
  if (!userId || !env.paradigmEnabled) {
    return store.updateSession(sessionId, { permissions: {} });
  }
  try {
    const me = (await paradigm.getMe(userId)) as { permissions?: Record<string, string[]> };
    const updated = store.updateSession(sessionId, {
      userId,
      permissions: me.permissions ?? {},
      exposureCheckedAt: new Date().toISOString(),
    });
    store.claimDraftsForUser(sessionId, userId);
    return updated;
  } catch {
    const updated = store.updateSession(sessionId, {
      userId,
      permissions: {},
      exposureCheckedAt: new Date().toISOString(),
    });
    store.claimDraftsForUser(sessionId, userId);
    return updated;
  }
}

function toPreviewFromMediaNode(node: ParadigmNode): MediaDraft["preview"] {
  const value = node.value_json ?? {};
  return {
    url: typeof value.url === "string" ? value.url : undefined,
    title: node.title,
    excerpt:
      typeof value.excerpt === "string"
        ? value.excerpt
        : "Imported from Paradigm.",
    domain:
      typeof value.domain === "string" ? value.domain : "unknown",
    author: typeof value.author === "string" ? value.author : undefined,
    mediaType:
      typeof value.mediaType === "string"
        ? (value.mediaType.toLowerCase() as MediaDraft["preview"]["mediaType"])
        : typeof value.mediatype === "string"
          ? (value.mediatype.toLowerCase() as MediaDraft["preview"]["mediaType"])
        : "article",
  };
}

function inferNodeKind(node: ParadigmNode): "media" | "reflection" | "concept" | "unknown" {
  if (node.schema_uri === schemaUris.mediaItem) {
    return "media";
  }
  if (node.schema_uri === schemaUris.reflectionEntry) {
    return "reflection";
  }
  if (node.schema_uri === schemaUris.conceptNode) {
    return "concept";
  }

  const value = node.value_json ?? {};
  if (
    typeof value.url === "string" ||
    typeof value.domain === "string" ||
    typeof value.mediaType === "string" ||
    typeof value.mediatype === "string"
  ) {
    return "media";
  }
  if (typeof value.reflection === "string" || typeof value.score === "number") {
    return "reflection";
  }
  if (typeof value.rationale === "string") {
    return "concept";
  }
  return "unknown";
}

function asGraphEdge(relationship: ParadigmRelationship): GraphEdge {
  return {
    id:
      relationship.id ??
      `${relationship.relationship_type}:${relationship.from_node_id}:${relationship.to_node_id}`,
    from: relationship.from_node_id,
    to: relationship.to_node_id,
    type: relationship.relationship_type,
    context: relationship.context,
  };
}

async function hydrateFromParadigm(sessionId: string, userId?: string, force = false) {
  if (!userId || !env.paradigmEnabled) {
    return { importedDrafts: 0, cursor: undefined as string | undefined };
  }

  const syncState = store.getSyncState(userId);
  let shouldRefetch = force || !syncState?.cursor;
  let nextCursor = syncState?.cursor;

  try {
    const syncResult = (await paradigm.sync(userId, syncState?.cursor)) as {
      cursor?: string;
      has_more?: boolean;
      stats?: { total?: number };
    };
    nextCursor = syncResult.cursor ?? nextCursor;
    if ((syncResult.stats?.total ?? 0) > 0 || syncResult.has_more || !syncState?.cursor) {
      shouldRefetch = true;
    }
  } catch {
    shouldRefetch = force || !syncState?.cursor;
  }

  if (!shouldRefetch) {
    if (nextCursor) {
      store.upsertSyncState(userId, nextCursor);
    }
    return { importedDrafts: 0, cursor: nextCursor };
  }

  const [nodeResponse, relationshipResponse] = await Promise.all([
    paradigm.listNodes(userId, {
      limit: 100,
      fields: "id,title,value_json,created_at,updated_at,schema_uri",
      order: "desc",
      sort: "updated_at",
    }),
    paradigm.listRelationships(userId, {
      limit: 1000,
    }),
  ]);

  const allNodes = ((nodeResponse as { nodes?: ParadigmNode[] }).nodes ?? []) as ParadigmNode[];
  const allRelationships = (
    (relationshipResponse as { relationships?: ParadigmRelationship[] }).relationships ?? []
  ).filter((relationship) => trackedRelationshipTypes.has(relationship.relationship_type));

  const mediaNodes = allNodes.filter((node) => inferNodeKind(node) === "media");
  const reflectionNodes = allNodes.filter((node) => inferNodeKind(node) === "reflection");
  const conceptNodes = allNodes.filter((node) => inferNodeKind(node) === "concept");

  const reflectionMap = new Map(reflectionNodes.map((node) => [node.id, node]));
  const mediaMap = new Map(mediaNodes.map((node) => [node.id, node]));

  for (const node of mediaNodes) {
    const graphNode: GraphNode = {
      id: node.id,
      label: node.title,
      kind: "media",
    };
    store.addGraphNode(graphNode);
  }

  for (const node of reflectionNodes) {
    const graphNode: GraphNode = {
      id: node.id,
      label: `Reflection: ${node.title}`,
      kind: "reflection",
    };
    store.addGraphNode(graphNode);
  }

  for (const node of conceptNodes) {
    const graphNode: GraphNode = {
      id: node.id,
      label: node.title,
      kind: "concept",
    };
    store.addGraphNode(graphNode);
  }

  for (const relationship of allRelationships) {
    store.addGraphEdge(asGraphEdge(relationship));
  }

  let importedDrafts = 0;

  for (const relationship of allRelationships.filter(
    (item) => item.relationship_type === relationshipTypes.reflectsOn,
  )) {
    const reflectionNode = reflectionMap.get(relationship.from_node_id);
    const mediaNode = mediaMap.get(relationship.to_node_id);
    if (!reflectionNode || !mediaNode) {
      continue;
    }

    const existingDraft = store.getDraftByMediaNodeId(sessionId, mediaNode.id);
    const reflectionValue = reflectionNode.value_json ?? {};
    const savedAt =
      (typeof reflectionValue.savedAt === "string" ? reflectionValue.savedAt : undefined) ??
      (typeof reflectionValue.savedat === "string" ? reflectionValue.savedat : undefined) ??
      reflectionNode.updated_at ??
      mediaNode.updated_at ??
      new Date().toISOString();

    const draftId = existingDraft?.id ?? `paradigm-${mediaNode.id}`;
    store.createDraft({
      id: draftId,
      ownerSessionId: sessionId,
      ownerUserId: userId,
      status: "saved",
      createdAt: mediaNode.created_at ?? savedAt,
      updatedAt: mediaNode.updated_at ?? savedAt,
      preview: toPreviewFromMediaNode(mediaNode),
      reflection:
        typeof reflectionValue.reflection === "string"
          ? reflectionValue.reflection
          : undefined,
      evaluation:
        typeof reflectionValue.score === "number"
          ? {
              accepted: true,
              score: reflectionValue.score,
              feedback:
                typeof reflectionValue.feedback === "string"
                  ? reflectionValue.feedback
                  : "Imported from Paradigm.",
              rubric: {
                hasPersonalReason: true,
                hasSpecificity: true,
                avoidsSummaryOnly: true,
              },
            }
          : undefined,
      selectedPrompt:
        typeof reflectionValue.promptUsed === "string"
          ? reflectionValue.promptUsed
          : typeof reflectionValue.promptused === "string"
            ? reflectionValue.promptused
          : undefined,
      committed: {
        draftId,
        mediaNodeId: mediaNode.id,
        reflectionNodeId: reflectionNode.id,
        savedAt,
      },
    });
    store.upsertSavedArtifact({
      draftId,
      mediaNodeId: mediaNode.id,
      reflectionNodeId: reflectionNode.id,
      conceptNodeIds: allRelationships
        .filter(
          (item) =>
            item.relationship_type === relationshipTypes.aboutConcept &&
            item.from_node_id === mediaNode.id,
        )
        .map((item) => item.to_node_id),
    });
    importedDrafts += existingDraft ? 0 : 1;
  }

  for (const mediaNode of mediaNodes) {
    const alreadyImported = store.getDraftByMediaNodeId(sessionId, mediaNode.id);
    const isLinkedMedia = allRelationships.some(
      (item) =>
        item.relationship_type === relationshipTypes.reflectsOn &&
        item.to_node_id === mediaNode.id,
    );
    if (alreadyImported || isLinkedMedia) {
      continue;
    }

    const draftId = `paradigm-${mediaNode.id}`;
    store.createDraft({
      id: draftId,
      ownerSessionId: sessionId,
      ownerUserId: userId,
      status: "saved",
      createdAt: mediaNode.created_at ?? new Date().toISOString(),
      updatedAt: mediaNode.updated_at ?? mediaNode.created_at ?? new Date().toISOString(),
      preview: toPreviewFromMediaNode(mediaNode),
    });
    store.addGraphNode({
      id: draftId,
      label: mediaNode.title,
      kind: "media",
    });
    importedDrafts += 1;
  }

  if (nextCursor) {
    store.upsertSyncState(userId, nextCursor);
  }
  return { importedDrafts, cursor: nextCursor };
}

export const appRouter = Router();

function getWebAppRedirectUrl(params: Record<string, string | undefined> = {}) {
  const base = env.webOrigins[0] ?? "http://localhost:5173";
  const url = new URL("/", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

appRouter.get("/auth/paradigm/start", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  store.createSession(sessionId);
  res.json({
    authorizeUrl: paradigm.authorizeUrl,
    mode: env.paradigmEnabled ? "paradigm" : "demo",
    hint: env.paradigmEnabled
      ? "Redirect the browser to authorizeUrl to connect Paradigm."
      : "Set PARADIGM_* env vars to enable live Paradigm auth. Demo mode still works locally.",
  });
});

appRouter.get("/auth/paradigm/callback", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }

  const userId = typeof req.query.user_id === "string" ? req.query.user_id : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  if (error) {
    return res.redirect(
      getWebAppRedirectUrl({
        auth: "error",
        message: `Paradigm authorization failed: ${error}`,
      }),
    );
  }

  const updated = await syncPermissions(sessionId, userId);
  if (updated.userId && canHydrateFromPermissions(updated.permissions)) {
    try {
      await hydrateFromParadigm(sessionId, updated.userId, true);
    } catch {
      // Don't block auth success on sync/hydration issues.
    }
  }
  res.redirect(
    getWebAppRedirectUrl({
      auth: "success",
      user_id: updated.userId,
    }),
  );
});

appRouter.get("/me", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const session = store.getSession(sessionId) ?? store.createSession(sessionId);
  const synced = await syncPermissions(sessionId, session.userId);
  if (synced.userId && canHydrateFromPermissions(synced.permissions)) {
    try {
      await hydrateFromParadigm(sessionId, synced.userId);
    } catch {
      // Surface existing local state even if Paradigm refresh fails.
    }
  }
  store.cleanupLegacyDraftGraphNodes(sessionId);
  const syncState = synced.userId ? store.getSyncState(synced.userId) : undefined;
  const response: MeResponse = {
    connected: Boolean(synced.userId),
    userId: synced.userId,
    permissions: synced.permissions,
    featureFlags: {
      canReadNodes: synced.permissions.nodes?.includes("read") ?? false,
      canCreateNodes: synced.permissions.nodes?.includes("create") ?? false,
      canReadRelationships: synced.permissions.relationships?.includes("read") ?? false,
      canCreateRelationships:
        synced.permissions.relationships?.includes("create") ?? false,
    },
    sync: {
      canSync: Boolean(synced.userId && canHydrateFromPermissions(synced.permissions)),
      lastSyncedAt: syncState?.lastSyncedAt,
      cursorPresent: Boolean(syncState?.cursor),
    },
    stats: store.getStats(sessionId),
  };
  res.json(response);
});

appRouter.get("/debug/paradigm/me", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const session = store.getSession(sessionId);
  if (!session?.userId) {
    return sendError(res, 400, "Connect Paradigm first.");
  }
  if (!env.paradigmEnabled) {
    return sendError(res, 400, "Paradigm is not configured.");
  }

  try {
    const me = await paradigm.getMe(session.userId);
    res.json(me);
  } catch (error) {
    sendError(res, 502, "Failed to fetch Paradigm /third-party/me.", {
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

appRouter.post("/sync", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const session = store.getSession(sessionId);
  if (!session?.userId) {
    return sendError(res, 400, "Connect Paradigm first.");
  }
  if (!canHydrateFromPermissions(session.permissions)) {
    return sendError(
      res,
      403,
      "Paradigm sync requires nodes.read and relationships.read permissions in the exposure profile.",
    );
  }
  try {
    const result = await hydrateFromParadigm(sessionId, session.userId, true);
    store.cleanupLegacyDraftGraphNodes(sessionId);
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendError(res, 502, "Failed to sync from Paradigm.", {
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

appRouter.post("/media/preview", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{ url?: string; title?: string; notes?: string }>(req);
  const source = body.url?.trim();

  let preview;
  if (source) {
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      return sendError(res, 400, "Please provide a valid URL.");
    }
    preview = {
      url: source,
      title: body.title?.trim() || parsed.hostname.replace(/^www\./, ""),
      excerpt: body.notes?.trim() || "Saved from the web for deeper reflection.",
      domain: parsed.hostname.replace(/^www\./, ""),
      mediaType: "article" as const,
    };
  } else {
    preview = {
      title: body.title?.trim() || "Untitled note",
      excerpt: body.notes?.trim() || "Manual note",
      domain: "manual",
      mediaType: "note" as const,
    };
  }

  const draft = store.createDraft(
    createDraftRecord(sessionId, {
      id: randomUUID(),
      status: "draft",
      ownerUserId: store.getSession(sessionId)?.userId,
      preview,
    }),
  );

  res.status(201).json(draft);
});

appRouter.get("/media/drafts", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  res.json({ drafts: store.listDrafts(sessionId) });
});

appRouter.post("/reflections/evaluate", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{ draftId: string; reflection: string }>(req);
  const draft = store.getDraft(body.draftId, sessionId);
  if (!draft) {
    return sendError(res, 404, "Draft not found.");
  }

  const evaluation = evaluateReflection(body.reflection);
  const updated = store.updateDraft(body.draftId, sessionId, {
    reflection: body.reflection,
    evaluation,
    status: evaluation.accepted ? "approved_for_save" : "needs_revision",
  });

  res.json({
    draft: updated,
    evaluation,
  });
});

appRouter.post("/reflections/prompts", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{ draftId: string }>(req);
  const draft = store.getDraft(body.draftId, sessionId);
  if (!draft) {
    return sendError(res, 404, "Draft not found.");
  }
  res.json({
    prompts: generateReflectionPrompts(draft.preview),
  });
});

appRouter.post("/media/commit", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{ draftId: string; selectedPrompt?: string }>(req);
  const draft = store.getDraft(body.draftId, sessionId);
  if (!draft) {
    return sendError(res, 404, "Draft not found.");
  }
  if (!draft.reflection?.trim()) {
    return sendError(res, 400, "Reflection is required before saving.");
  }
  const evaluation = draft.evaluation ?? evaluateReflection(draft.reflection);
  if (!evaluation.accepted) {
    return sendError(res, 400, "Reflection needs revision before saving.", {
      evaluation,
    });
  }
  if (draft.status === "saved" && draft.committed) {
    return res.json(draft.committed);
  }

  const session = store.getSession(sessionId) ?? store.createSession(sessionId);
  const now = new Date().toISOString();
  let mediaNodeId = `demo-media-${draft.id}`;
  let reflectionNodeId = `demo-reflection-${draft.id}`;

  if (env.paradigmEnabled && session.userId) {
    try {
      if (canCreateNodes(session.permissions)) {
        const mediaNode = (await paradigm.createNode(session.userId, {
          title: draft.preview.title,
          schema_uri: schemaUris.mediaItem,
          content_type: "text",
          source_type: draft.preview.url ? "web" : "manual",
          content_timestamp: now,
          value_json: {
            url: draft.preview.url,
            excerpt: draft.preview.excerpt,
            domain: draft.preview.domain,
            mediatype: draft.preview.mediaType,
            author: draft.preview.author,
            capturedat: now,
          },
        })) as { id: string };
        const reflectionNode = (await paradigm.createNode(session.userId, {
          title: `Reflection on ${draft.preview.title}`,
          schema_uri: schemaUris.reflectionEntry,
          content_type: "text",
          source_type: "manual",
          content_timestamp: now,
          value_json: {
            reflection: draft.reflection,
            score: evaluation.score,
            feedback: evaluation.feedback,
            promptused: body.selectedPrompt,
            savedat: now,
          },
        })) as { id: string };
        mediaNodeId = mediaNode.id;
        reflectionNodeId = reflectionNode.id;
        if (canCreateRelationships(session.permissions)) {
          await paradigm.createRelationship(session.userId, {
            from_node_id: reflectionNodeId,
            to_node_id: mediaNodeId,
            relationship_type: relationshipTypes.reflectsOn,
            context: "User-authored reflection attached during save.",
          });
        }
      }
    } catch (error) {
      return sendError(res, 502, "Failed to save to Paradigm.", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  store.addGraphNode({
    id: mediaNodeId,
    label: draft.preview.title,
    kind: "media",
  });
  store.addGraphNode({
    id: reflectionNodeId,
    label: `Reflection: ${draft.preview.title}`,
    kind: "reflection",
  });
  store.addGraphEdge({
    id: `edge-${draft.id}`,
    from: reflectionNodeId,
    to: mediaNodeId,
    type: relationshipTypes.reflectsOn,
  });

  const committed = {
    draftId: draft.id,
    mediaNodeId,
    reflectionNodeId,
    savedAt: now,
  };
  store.updateDraft(draft.id, sessionId, {
    selectedPrompt: body.selectedPrompt,
  });
  store.commitDraft(sessionId, committed);

  res.json(committed);
});

appRouter.get("/concepts/suggestions", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const suggestions = store
    .listConceptSuggestions(sessionId)
    .concat(
      store
        .listDrafts(sessionId)
        .filter((draft) => draft.status === "saved")
        .flatMap((draft) => {
          if (store.listConceptSuggestions(sessionId).some((item) => item.sourceDraftId === draft.id)) {
            return [];
          }
          const candidate = buildConceptSuggestionCandidate(draft);
          const suggestion: ConceptSuggestion = {
            id: randomUUID(),
            label: candidate.label,
            rationale: candidate.rationale,
            sourceDraftId: draft.id,
            approved: false,
            relatedConceptLabels: candidate.relatedConceptLabels,
          };
          store.saveConceptSuggestion(suggestion);
          return [suggestion];
        }),
    );
  res.json({ suggestions });
});

appRouter.post("/concepts/approve", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{ suggestionId: string }>(req);
  const suggestion = store.approveConceptSuggestion(body.suggestionId, sessionId);
  if (!suggestion) {
    return sendError(res, 404, "Suggestion not found.");
  }

  const session = store.getSession(sessionId);
  const existingConceptNode = store.findConceptNodeByLabel(suggestion.label);
  let conceptNodeId = existingConceptNode?.id ?? `concept-${suggestion.id}`;

  if (env.paradigmEnabled && session?.userId) {
    try {
      if (!existingConceptNode && canCreateNodes(session.permissions)) {
        const conceptNode = (await paradigm.createNode(session.userId, {
          title: suggestion.label,
          schema_uri: schemaUris.conceptNode,
          content_type: "text",
          source_type: "ai-suggestion",
          value_json: {
            rationale: suggestion.rationale,
            relatedlabels: suggestion.relatedConceptLabels,
          },
        })) as { id: string };
        conceptNodeId = conceptNode.id;
      }

      const saved = store.getSavedArtifact(suggestion.sourceDraftId);
      const conceptExistsInParadigm = !conceptNodeId.startsWith("concept-");
      if (saved && conceptExistsInParadigm && canCreateRelationships(session.permissions)) {
        await paradigm.createRelationship(session.userId, {
          from_node_id: saved.mediaNodeId,
          to_node_id: conceptNodeId,
          relationship_type: relationshipTypes.aboutConcept,
          context: suggestion.rationale,
        });
      }
    } catch (error) {
      return sendError(res, 502, "Failed to persist approved concept to Paradigm.", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  store.addGraphNode({
    id: conceptNodeId,
    label: suggestion.label,
    kind: "concept",
  });
  store.addGraphEdge({
    id: `concept-edge-${suggestion.id}`,
    from: suggestion.sourceDraftId,
    to: conceptNodeId,
    type: relationshipTypes.aboutConcept,
    context: suggestion.rationale,
  });
  store.attachConceptNode(suggestion.sourceDraftId, conceptNodeId);
  res.json({ suggestion: { ...suggestion, approved: true }, conceptNodeId });
});

appRouter.post("/concepts/update", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<{
    suggestionId: string;
    label: string;
    rationale: string;
    relatedConceptLabels: string[];
  }>(req);
  const updated = store.updateConceptSuggestion(body.suggestionId, sessionId, {
    label: body.label.trim(),
    rationale: body.rationale.trim(),
    relatedConceptLabels: body.relatedConceptLabels
      .map((item) => item.trim())
      .filter(Boolean),
  });
  if (!updated) {
    return sendError(res, 404, "Suggestion not found.");
  }
  res.json({ suggestion: updated });
});

appRouter.get("/graph", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  res.json(store.getGraph(sessionId));
});

appRouter.get("/knowledge-graph", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }

  res.json(
    buildKnowledgeGraph({
      drafts: store.listDrafts(sessionId),
      suggestions: store.listConceptSuggestions(sessionId),
      graph: store.getGraph(sessionId),
    }),
  );
});

appRouter.get("/quiz/weekly", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const questions = buildQuizQuestions(
    store.listDrafts(sessionId),
    (draftId) => store.getRepetitionScore(draftId),
  );
  const quiz = store.createQuiz({
    sessionId: randomUUID(),
    ownerSessionId: sessionId,
    questions,
    answers: [],
    createdAt: new Date().toISOString(),
  });
  res.json(quiz);
});

appRouter.post("/quiz/:id/answer", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const body = readJson<QuizAnswerPayload & { questionId: string }>(req);
  const quiz = store.getQuiz(sessionId, req.params.id);
  if (!quiz) {
    return sendError(res, 404, "Quiz not found.");
  }
  const question = quiz.questions.find((item) => item.id === body.questionId);
  if (!question) {
    return sendError(res, 404, "Question not found.");
  }
  const scored = scoreQuizAnswer(question, body.answer);
  const updated = store.answerQuizQuestion(sessionId, req.params.id, {
    ...question,
    userAnswer: body.answer,
    correct: scored.correct,
    feedback: scored.feedback,
  });
  res.json(updated);
});

appRouter.get("/quiz/:id/result", (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) {
    return;
  }
  const result = store.finalizeQuiz(sessionId, req.params.id);
  if (!result) {
    return sendError(res, 404, "Quiz not found.");
  }
  res.json(result);
});
