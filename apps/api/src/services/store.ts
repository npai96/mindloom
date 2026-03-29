import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import type {
  CommittedMediaItem,
  ConceptSuggestion,
  DraftStatus,
  GraphEdge,
  GraphNode,
  MediaDraft,
  ParadigmNodePayload,
  QuizAnsweredQuestion,
  QuizQuestion,
  QuizResult,
  ReflectionEvaluation,
} from "@actually-learn/shared";

type SessionRecord = {
  sessionId: string;
  userId?: string;
  permissions: Record<string, string[]>;
  exposureCheckedAt?: string;
};

type DraftRecord = MediaDraft & {
  ownerSessionId: string;
  ownerUserId?: string;
  previewSource?: ParadigmNodePayload;
  committed?: CommittedMediaItem;
};

type SavedArtifact = {
  draftId: string;
  mediaNodeId: string;
  reflectionNodeId: string;
  conceptNodeIds: string[];
};

type QuizState = {
  sessionId: string;
  ownerSessionId: string;
  questions: QuizQuestion[];
  answers: QuizAnsweredQuestion[];
  createdAt: string;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = resolve(currentDir, "../../data/actually-learn.sqlite");
const dbPath = process.env.APP_DB_PATH ?? defaultDbPath;
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    permissions_json TEXT NOT NULL,
    exposure_checked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    owner_session_id TEXT NOT NULL,
    owner_user_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    preview_json TEXT NOT NULL,
    reflection TEXT,
    evaluation_json TEXT,
    selected_prompt TEXT,
    preview_source_json TEXT,
    committed_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_drafts_owner_session_id
    ON drafts (owner_session_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS saved_artifacts (
    draft_id TEXT PRIMARY KEY,
    media_node_id TEXT NOT NULL,
    reflection_node_id TEXT NOT NULL,
    concept_node_ids_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS concept_suggestions (
    id TEXT PRIMARY KEY,
    source_draft_id TEXT NOT NULL,
    label TEXT NOT NULL,
    rationale TEXT NOT NULL,
    approved INTEGER NOT NULL,
    related_concept_labels_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_concept_suggestions_source_draft_id
    ON concept_suggestions (source_draft_id);

  CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    type TEXT NOT NULL,
    context TEXT
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    session_id TEXT PRIMARY KEY,
    owner_session_id TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reflection_days (
    session_id TEXT NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (session_id, day)
  );

  CREATE TABLE IF NOT EXISTS weekly_recaps (
    session_id TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repetition_scores (
    draft_id TEXT PRIMARY KEY,
    score INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    user_id TEXT PRIMARY KEY,
    cursor TEXT,
    last_synced_at TEXT
  );
`);

const draftColumns = db
  .prepare(`PRAGMA table_info(drafts)`)
  .all() as Array<{ name: string }>;
if (!draftColumns.some((column) => column.name === "owner_user_id")) {
  db.exec(`ALTER TABLE drafts ADD COLUMN owner_user_id TEXT`);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

function mapSession(row: Record<string, unknown> | undefined): SessionRecord | undefined {
  if (!row) {
    return undefined;
  }
  return {
    sessionId: String(row.session_id),
    userId: row.user_id ? String(row.user_id) : undefined,
    permissions: parseJson(String(row.permissions_json), {}),
    exposureCheckedAt: row.exposure_checked_at
      ? String(row.exposure_checked_at)
      : undefined,
  };
}

function mapDraft(row: Record<string, unknown>): DraftRecord {
  return {
    id: String(row.id),
    ownerSessionId: String(row.owner_session_id),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    status: row.status as DraftStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    preview: parseJson(String(row.preview_json), {} as DraftRecord["preview"]),
    reflection: row.reflection ? String(row.reflection) : undefined,
    evaluation: parseJson(
      row.evaluation_json ? String(row.evaluation_json) : undefined,
      undefined,
    ) as ReflectionEvaluation | undefined,
    selectedPrompt: row.selected_prompt ? String(row.selected_prompt) : undefined,
    previewSource: parseJson(
      row.preview_source_json ? String(row.preview_source_json) : undefined,
      undefined,
    ) as ParadigmNodePayload | undefined,
    committed: parseJson(
      row.committed_json ? String(row.committed_json) : undefined,
      undefined,
    ) as CommittedMediaItem | undefined,
  };
}

function mapConceptSuggestion(row: Record<string, unknown>): ConceptSuggestion {
  return {
    id: String(row.id),
    sourceDraftId: String(row.source_draft_id),
    label: String(row.label),
    rationale: String(row.rationale),
    approved: Number(row.approved) === 1,
    relatedConceptLabels: parseJson(String(row.related_concept_labels_json), []),
  };
}

function mapGraphNode(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    label: String(row.label),
    kind: row.kind as GraphNode["kind"],
  };
}

function mapGraphEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: String(row.id),
    from: String(row.from_node_id),
    to: String(row.to_node_id),
    type: String(row.type),
    context: row.context ? String(row.context) : undefined,
  };
}

function mapQuiz(row: Record<string, unknown>): QuizState {
  return {
    sessionId: String(row.session_id),
    ownerSessionId: String(row.owner_session_id),
    questions: parseJson(String(row.questions_json), []),
    answers: parseJson(String(row.answers_json), []),
    createdAt: String(row.created_at),
  };
}

const insertSession = db.prepare(`
  INSERT OR IGNORE INTO sessions (session_id, user_id, permissions_json, exposure_checked_at)
  VALUES (?, NULL, ?, NULL)
`);
const getSessionStmt = db.prepare(`
  SELECT session_id, user_id, permissions_json, exposure_checked_at
  FROM sessions
  WHERE session_id = ?
`);
const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (session_id, user_id, permissions_json, exposure_checked_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    user_id = excluded.user_id,
    permissions_json = excluded.permissions_json,
    exposure_checked_at = excluded.exposure_checked_at
`);
const insertDraftStmt = db.prepare(`
  INSERT INTO drafts (
    id, owner_session_id, owner_user_id, status, created_at, updated_at, preview_json,
    reflection, evaluation_json, selected_prompt, preview_source_json, committed_json
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    owner_session_id = excluded.owner_session_id,
    owner_user_id = excluded.owner_user_id,
    status = excluded.status,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    preview_json = excluded.preview_json,
    reflection = excluded.reflection,
    evaluation_json = excluded.evaluation_json,
    selected_prompt = excluded.selected_prompt,
    preview_source_json = excluded.preview_source_json,
    committed_json = excluded.committed_json
`);
const listDraftsStmt = db.prepare(`
  SELECT *
  FROM drafts
  WHERE owner_session_id = ? OR owner_user_id = ?
  ORDER BY created_at DESC
`);
const getDraftStmt = db.prepare(`
  SELECT *
  FROM drafts
  WHERE id = ? AND (owner_session_id = ? OR owner_user_id = ?)
`);
const updateDraftStmt = db.prepare(`
  UPDATE drafts
  SET owner_user_id = ?, status = ?, updated_at = ?, preview_json = ?, reflection = ?, evaluation_json = ?,
      selected_prompt = ?, preview_source_json = ?, committed_json = ?
  WHERE id = ? AND (owner_session_id = ? OR owner_user_id = ?)
`);
const upsertSavedArtifactStmt = db.prepare(`
  INSERT INTO saved_artifacts (draft_id, media_node_id, reflection_node_id, concept_node_ids_json)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(draft_id) DO UPDATE SET
    media_node_id = excluded.media_node_id,
    reflection_node_id = excluded.reflection_node_id,
    concept_node_ids_json = excluded.concept_node_ids_json
`);
const getSavedArtifactStmt = db.prepare(`
  SELECT draft_id, media_node_id, reflection_node_id, concept_node_ids_json
  FROM saved_artifacts
  WHERE draft_id = ?
`);
const getDraftByMediaNodeIdStmt = db.prepare(`
  SELECT d.*
  FROM drafts d
  INNER JOIN saved_artifacts sa ON sa.draft_id = d.id
  WHERE (d.owner_session_id = ? OR d.owner_user_id = ?) AND sa.media_node_id = ?
  LIMIT 1
`);
const insertConceptSuggestionStmt = db.prepare(`
  INSERT INTO concept_suggestions (
    id, source_draft_id, label, rationale, approved, related_concept_labels_json
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    source_draft_id = excluded.source_draft_id,
    label = excluded.label,
    rationale = excluded.rationale,
    approved = excluded.approved,
    related_concept_labels_json = excluded.related_concept_labels_json
`);
const listConceptSuggestionsStmt = db.prepare(`
  SELECT cs.*
  FROM concept_suggestions cs
  INNER JOIN drafts d ON d.id = cs.source_draft_id
  WHERE d.owner_session_id = ? OR d.owner_user_id = ?
`);
const getConceptSuggestionStmt = db.prepare(`
  SELECT *
  FROM concept_suggestions
  WHERE id = ?
`);
const approveConceptSuggestionStmt = db.prepare(`
  UPDATE concept_suggestions
  SET approved = 1
  WHERE id = ?
`);
const upsertGraphNodeStmt = db.prepare(`
  INSERT INTO graph_nodes (id, label, kind)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label,
    kind = excluded.kind
`);
const upsertGraphEdgeStmt = db.prepare(`
  INSERT INTO graph_edges (id, from_node_id, to_node_id, type, context)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    from_node_id = excluded.from_node_id,
    to_node_id = excluded.to_node_id,
    type = excluded.type,
    context = excluded.context
`);
const allGraphNodesStmt = db.prepare(`SELECT id, label, kind FROM graph_nodes`);
const allGraphEdgesStmt = db.prepare(`
  SELECT id, from_node_id, to_node_id, type, context
  FROM graph_edges
`);
const deleteGraphNodeStmt = db.prepare(`
  DELETE FROM graph_nodes
  WHERE id = ?
`);
const deleteGraphEdgesForNodeStmt = db.prepare(`
  DELETE FROM graph_edges
  WHERE from_node_id = ? OR to_node_id = ?
`);
const insertQuizStmt = db.prepare(`
  INSERT INTO quizzes (session_id, owner_session_id, questions_json, answers_json, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    owner_session_id = excluded.owner_session_id,
    questions_json = excluded.questions_json,
    answers_json = excluded.answers_json,
    created_at = excluded.created_at
`);
const getQuizStmt = db.prepare(`
  SELECT *
  FROM quizzes
  WHERE session_id = ? AND owner_session_id = ?
`);
const updateQuizAnswersStmt = db.prepare(`
  UPDATE quizzes
  SET answers_json = ?
  WHERE session_id = ? AND owner_session_id = ?
`);
const upsertReflectionDayStmt = db.prepare(`
  INSERT OR IGNORE INTO reflection_days (session_id, day)
  VALUES (?, ?)
`);
const listReflectionDaysStmt = db.prepare(`
  SELECT day
  FROM reflection_days
  WHERE session_id = ?
  ORDER BY day ASC
`);
const getWeeklyRecapStmt = db.prepare(`
  SELECT count
  FROM weekly_recaps
  WHERE session_id = ?
`);
const upsertWeeklyRecapStmt = db.prepare(`
  INSERT INTO weekly_recaps (session_id, count)
  VALUES (?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    count = excluded.count
`);
const getRepetitionScoreStmt = db.prepare(`
  SELECT score
  FROM repetition_scores
  WHERE draft_id = ?
`);
const upsertRepetitionScoreStmt = db.prepare(`
  INSERT INTO repetition_scores (draft_id, score)
  VALUES (?, ?)
  ON CONFLICT(draft_id) DO UPDATE SET
    score = excluded.score
`);
const getSyncStateStmt = db.prepare(`
  SELECT user_id, cursor, last_synced_at
  FROM sync_state
  WHERE user_id = ?
`);
const upsertSyncStateStmt = db.prepare(`
  INSERT INTO sync_state (user_id, cursor, last_synced_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    cursor = excluded.cursor,
    last_synced_at = excluded.last_synced_at
`);
const claimDraftsForUserStmt = db.prepare(`
  UPDATE drafts
  SET owner_user_id = ?
  WHERE owner_session_id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)
`);

export const store = {
  createSession(sessionId: string) {
    insertSession.run(sessionId, serializeJson({}));
    return this.getSession(sessionId)!;
  },
  getSession(sessionId: string) {
    return mapSession(getSessionStmt.get(sessionId) as Record<string, unknown> | undefined);
  },
  updateSession(sessionId: string, partial: Partial<SessionRecord>) {
    const current = this.getSession(sessionId) ?? this.createSession(sessionId);
    const updated = { ...current, ...partial };
    upsertSessionStmt.run(
      updated.sessionId,
      updated.userId ?? null,
      serializeJson(updated.permissions),
      updated.exposureCheckedAt ?? null,
    );
    return updated;
  },
  createDraft(draft: DraftRecord) {
    insertDraftStmt.run(
      draft.id,
      draft.ownerSessionId,
      draft.ownerUserId ?? null,
      draft.status,
      draft.createdAt,
      draft.updatedAt,
      serializeJson(draft.preview),
      draft.reflection ?? null,
      draft.evaluation ? serializeJson(draft.evaluation) : null,
      draft.selectedPrompt ?? null,
      draft.previewSource ? serializeJson(draft.previewSource) : null,
      draft.committed ? serializeJson(draft.committed) : null,
    );
    return draft;
  },
  listDrafts(sessionId: string) {
    const session = this.getSession(sessionId);
    const ownerUserId = session?.userId ?? null;
    return (listDraftsStmt.all(sessionId, ownerUserId) as Record<string, unknown>[]).map(
      mapDraft,
    );
  },
  getDraft(draftId: string, sessionId: string) {
    const session = this.getSession(sessionId);
    const row = getDraftStmt.get(
      draftId,
      sessionId,
      session?.userId ?? null,
    ) as Record<string, unknown> | undefined;
    return row ? mapDraft(row) : undefined;
  },
  updateDraft(
    draftId: string,
    sessionId: string,
    updates: Partial<DraftRecord> & { status?: DraftStatus },
  ) {
    const current = this.getDraft(draftId, sessionId);
    if (!current) {
      return undefined;
    }
    const updated: DraftRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    updateDraftStmt.run(
      updated.ownerUserId ?? null,
      updated.status,
      updated.updatedAt,
      serializeJson(updated.preview),
      updated.reflection ?? null,
      updated.evaluation ? serializeJson(updated.evaluation) : null,
      updated.selectedPrompt ?? null,
      updated.previewSource ? serializeJson(updated.previewSource) : null,
      updated.committed ? serializeJson(updated.committed) : null,
      draftId,
      sessionId,
      current.ownerUserId ?? null,
    );
    return updated;
  },
  commitDraft(sessionId: string, committed: CommittedMediaItem) {
    const draft = this.getDraft(committed.draftId, sessionId);
    if (!draft) {
      return undefined;
    }
    const updated = this.updateDraft(committed.draftId, sessionId, {
      status: "saved",
      committed,
    });
    upsertSavedArtifactStmt.run(
      committed.draftId,
      committed.mediaNodeId,
      committed.reflectionNodeId,
      serializeJson([]),
    );
    this.markReflectionDay(sessionId, committed.savedAt);
    return updated;
  },
  saveConceptSuggestion(suggestion: ConceptSuggestion) {
    insertConceptSuggestionStmt.run(
      suggestion.id,
      suggestion.sourceDraftId,
      suggestion.label,
      suggestion.rationale,
      suggestion.approved ? 1 : 0,
      serializeJson(suggestion.relatedConceptLabels),
    );
    return suggestion;
  },
  listConceptSuggestions(sessionId: string) {
    const session = this.getSession(sessionId);
    return (
      listConceptSuggestionsStmt.all(
        sessionId,
        session?.userId ?? null,
      ) as Record<string, unknown>[]
    ).map(mapConceptSuggestion);
  },
  approveConceptSuggestion(id: string, sessionId: string) {
    const suggestionRow = getConceptSuggestionStmt.get(id) as Record<string, unknown> | undefined;
    if (!suggestionRow) {
      return undefined;
    }
    const suggestion = mapConceptSuggestion(suggestionRow);
    const draft = this.getDraft(suggestion.sourceDraftId, sessionId);
    if (!draft) {
      return undefined;
    }
    approveConceptSuggestionStmt.run(id);
    return { ...suggestion, approved: true };
  },
  addGraphNode(node: GraphNode) {
    upsertGraphNodeStmt.run(node.id, node.label, node.kind);
  },
  addGraphEdge(edge: GraphEdge) {
    upsertGraphEdgeStmt.run(edge.id, edge.from, edge.to, edge.type, edge.context ?? null);
  },
  getGraph(sessionId: string) {
    const ownedDraftIds = new Set(this.listDrafts(sessionId).map((draft) => draft.id));
    const artifactNodeIds = new Set<string>();
    const draftIdsWithSavedArtifacts = new Set<string>();
    for (const draftId of ownedDraftIds) {
      const artifact = this.getSavedArtifact(draftId);
      if (!artifact) {
        continue;
      }
      draftIdsWithSavedArtifacts.add(draftId);
      artifactNodeIds.add(artifact.mediaNodeId);
      artifactNodeIds.add(artifact.reflectionNodeId);
      artifact.conceptNodeIds.forEach((id) => artifactNodeIds.add(id));
    }

    const nodes = (allGraphNodesStmt.all() as Record<string, unknown>[])
      .map(mapGraphNode)
      .filter(
        (node) => {
          if (draftIdsWithSavedArtifacts.has(node.id)) {
            return false;
          }
          return (
            ownedDraftIds.has(node.id) || artifactNodeIds.has(node.id) || node.kind === "concept"
          );
        },
      );
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = (allGraphEdgesStmt.all() as Record<string, unknown>[])
      .map(mapGraphEdge)
      .filter((edge) => {
        if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
          return true;
        }
        return ownedDraftIds.has(edge.from) || ownedDraftIds.has(edge.to);
      });
    return { nodes, edges };
  },
  createQuiz(quiz: QuizState) {
    insertQuizStmt.run(
      quiz.sessionId,
      quiz.ownerSessionId,
      serializeJson(quiz.questions),
      serializeJson(quiz.answers),
      quiz.createdAt,
    );
    return quiz;
  },
  getQuiz(sessionId: string, quizId: string) {
    const row = getQuizStmt.get(quizId, sessionId) as Record<string, unknown> | undefined;
    return row ? mapQuiz(row) : undefined;
  },
  answerQuizQuestion(sessionId: string, quizId: string, answered: QuizAnsweredQuestion) {
    const quiz = this.getQuiz(sessionId, quizId);
    if (!quiz) {
      return undefined;
    }
    const deduped = quiz.answers.filter((item) => item.id !== answered.id);
    deduped.push(answered);
    updateQuizAnswersStmt.run(serializeJson(deduped), quizId, sessionId);
    const currentScore = this.getRepetitionScore(answered.draftId);
    upsertRepetitionScoreStmt.run(
      answered.draftId,
      Math.max(0, currentScore + (answered.correct ? 1 : -1)),
    );
    return {
      ...quiz,
      answers: deduped,
    };
  },
  finalizeQuiz(sessionId: string, quizId: string): QuizResult | undefined {
    const quiz = this.getQuiz(sessionId, quizId);
    if (!quiz) {
      return undefined;
    }
    const score =
      quiz.answers.length === 0
        ? 0
        : Math.round(
            (quiz.answers.filter((item) => item.correct).length / quiz.answers.length) * 100,
          );
    const weeklyRecaps = (getWeeklyRecapStmt.get(sessionId) as { count?: number } | undefined)
      ?.count ?? 0;
    upsertWeeklyRecapStmt.run(sessionId, weeklyRecaps + 1);
    return {
      sessionId: quizId,
      createdAt: quiz.createdAt,
      questions: quiz.answers,
      score,
      streaks: {
        reflectionDays: this.getReflectionStreak(sessionId),
        weeklyRecaps: weeklyRecaps + 1,
      },
    };
  },
  getReflectionStreak(sessionId: string) {
    const days = (listReflectionDaysStmt.all(sessionId) as Array<{ day: string }>).map(
      (row) => row.day,
    );
    if (days.length === 0) {
      return 0;
    }

    let streak = 1;
    for (let i = days.length - 1; i > 0; i -= 1) {
      const current = new Date(days[i]);
      const previous = new Date(days[i - 1]);
      const diff = (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        streak += 1;
      } else if (diff > 1) {
        break;
      }
    }
    return streak;
  },
  markReflectionDay(sessionId: string, isoDateTime: string) {
    upsertReflectionDayStmt.run(sessionId, isoDateTime.slice(0, 10));
  },
  getRepetitionScore(draftId: string) {
    const row = getRepetitionScoreStmt.get(draftId) as { score?: number } | undefined;
    return row?.score ?? 0;
  },
  getStats(sessionId: string) {
    const suggestions = this.listConceptSuggestions(sessionId);
    return {
      savedCount: this.listDrafts(sessionId).filter((draft) => draft.status === "saved").length,
      conceptCount: suggestions.filter((item) => item.approved).length,
      pendingSuggestions: suggestions.filter((item) => !item.approved).length,
    };
  },
  getSavedArtifact(draftId: string) {
    const row = getSavedArtifactStmt.get(draftId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      draftId: String(row.draft_id),
      mediaNodeId: String(row.media_node_id),
      reflectionNodeId: String(row.reflection_node_id),
      conceptNodeIds: parseJson(String(row.concept_node_ids_json), []),
    } satisfies SavedArtifact;
  },
  getDraftByMediaNodeId(sessionId: string, mediaNodeId: string) {
    const session = this.getSession(sessionId);
    const row = getDraftByMediaNodeIdStmt.get(
      sessionId,
      session?.userId ?? null,
      mediaNodeId,
    ) as Record<string, unknown> | undefined;
    return row ? mapDraft(row) : undefined;
  },
  claimDraftsForUser(sessionId: string, userId: string) {
    claimDraftsForUserStmt.run(userId, sessionId, userId);
  },
  upsertSavedArtifact(artifact: SavedArtifact) {
    upsertSavedArtifactStmt.run(
      artifact.draftId,
      artifact.mediaNodeId,
      artifact.reflectionNodeId,
      serializeJson(artifact.conceptNodeIds),
    );
    return artifact;
  },
  attachConceptNode(draftId: string, conceptNodeId: string) {
    const artifact = this.getSavedArtifact(draftId);
    if (!artifact) {
      return;
    }
    const updated = [...new Set([...artifact.conceptNodeIds, conceptNodeId])];
    upsertSavedArtifactStmt.run(
      draftId,
      artifact.mediaNodeId,
      artifact.reflectionNodeId,
      serializeJson(updated),
    );
  },
  getSyncState(userId: string) {
    const row = getSyncStateStmt.get(userId) as
      | { user_id: string; cursor: string | null; last_synced_at: string | null }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      userId: row.user_id,
      cursor: row.cursor ?? undefined,
      lastSyncedAt: row.last_synced_at ?? undefined,
    };
  },
  upsertSyncState(userId: string, cursor?: string) {
    const lastSyncedAt = new Date().toISOString();
    upsertSyncStateStmt.run(userId, cursor ?? null, lastSyncedAt);
    return { userId, cursor, lastSyncedAt };
  },
  cleanupLegacyDraftGraphNodes(sessionId: string) {
    for (const draftId of this.listDrafts(sessionId).map((draft) => draft.id)) {
      const artifact = this.getSavedArtifact(draftId);
      if (!artifact) {
        continue;
      }
      deleteGraphEdgesForNodeStmt.run(draftId, draftId);
      deleteGraphNodeStmt.run(draftId);
    }
  },
};

export function createDraftRecord(
  sessionId: string,
  draft: Omit<MediaDraft, "createdAt" | "updatedAt"> & {
    evaluation?: ReflectionEvaluation;
    ownerUserId?: string;
  },
): DraftRecord {
  const now = new Date().toISOString();
  return {
    ...draft,
    ownerSessionId: sessionId,
    ownerUserId: draft.ownerUserId,
    createdAt: now,
    updatedAt: now,
  };
}
