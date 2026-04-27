export const schemaUris = {
  mediaItem: "custom:actually-learn-media-item-2",
  reflectionEntry: "custom:actually-learn-reflection-entry",
  conceptNode: "custom:actually-learn-concept-node",
  quizSession: "custom:actually-learn-quiz-session",
  quizResponse: "custom:actually-learn-quiz-response",
} as const;

export const relationshipTypes = {
  reflectsOn: "reflects_on",
  aboutConcept: "about_concept",
  relatedTo: "related_to",
  reviewedIn: "reviewed_in",
} as const;

export const draftStatuses = [
  "draft",
  "needs_revision",
  "approved_for_save",
  "saved",
] as const;

export type DraftStatus = (typeof draftStatuses)[number];

export type PermissionResource =
  | "nodes"
  | "relationships"
  | "tags"
  | "plugins";

export type ReflectionEvaluation = {
  accepted: boolean;
  score: number;
  feedback: string;
  rubric: {
    hasPersonalReason: boolean;
    hasSpecificity: boolean;
    avoidsSummaryOnly: boolean;
  };
};

export type ReflectionPrompt = {
  id: string;
  prompt: string;
};

export type MediaPreview = {
  url?: string;
  title: string;
  excerpt: string;
  domain: string;
  author?: string;
  mediaType: "article" | "video" | "podcast" | "tweet" | "image" | "note";
};

export type MediaDraft = {
  id: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  preview: MediaPreview;
  reflection?: string;
  evaluation?: ReflectionEvaluation;
  selectedPrompt?: string;
};

export type CommittedMediaItem = {
  draftId: string;
  mediaNodeId: string;
  reflectionNodeId: string;
  savedAt: string;
};

export type ConceptSuggestionStatus = "suggested" | "approved" | "dismissed";

export type ConceptSuggestionEvidence = {
  sourcePhrase?: string;
  reflectionPhrase?: string;
  reason: string;
};

export type ConceptSuggestion = {
  id: string;
  label: string;
  rationale: string;
  sourceDraftId: string;
  approved: boolean;
  status?: ConceptSuggestionStatus;
  relatedConceptLabels: string[];
  evidence?: ConceptSuggestionEvidence;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: "media" | "reflection" | "concept";
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
  context?: string;
};

export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type KnowledgeGraphNode = {
  id: string;
  title: string;
  summary: string;
  reflection?: string;
  excerpt?: string;
  domain?: string;
  mediaType?: string;
  score?: number;
  concepts: string[];
};

export type KnowledgeGraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  weight: number;
  reasons: string[];
  status?: GraphEdgeCandidateStatus;
};

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
};

export type GraphEdgeCandidateStatus = "suggested" | "approved" | "dismissed";

export type GraphEdgeCandidate = KnowledgeGraphEdge & {
  status: GraphEdgeCandidateStatus;
};

export type QuizQuestionType =
  | "summary_recall"
  | "why_saved"
  | "concept_match";

export type QuizQuestion = {
  id: string;
  prompt: string;
  type: QuizQuestionType;
  draftId: string;
  itemTitle: string;
  conceptHint?: string;
};

export type QuizAnswerPayload = {
  answer: string;
};

export type QuizAnsweredQuestion = QuizQuestion & {
  userAnswer: string;
  correct: boolean;
  feedback: string;
};

export type QuizResult = {
  sessionId: string;
  createdAt: string;
  questions: QuizAnsweredQuestion[];
  score: number;
  streaks: {
    reflectionDays: number;
    weeklyRecaps: number;
  };
};

export type MeResponse = {
  connected: boolean;
  userId?: string;
  permissions: Partial<Record<PermissionResource, string[]>>;
  featureFlags: {
    canReadNodes: boolean;
    canCreateNodes: boolean;
    canReadRelationships: boolean;
    canCreateRelationships: boolean;
  };
  sync: {
    canSync: boolean;
    lastSyncedAt?: string;
    cursorPresent: boolean;
  };
  stats: {
    savedCount: number;
    conceptCount: number;
    pendingSuggestions: number;
  };
};

export type ParadigmNodePayload = {
  title: string;
  value_json: Record<string, unknown>;
  schema_uri: string;
  content_type?: string;
  tags?: string[];
  source_type?: string;
  content_timestamp?: string;
};

export type ParadigmRelationshipPayload = {
  from_node_id: string;
  to_node_id: string;
  relationship_type: string;
  context?: string;
  bidirectional?: boolean;
};
