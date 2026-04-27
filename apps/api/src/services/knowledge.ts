import type {
  ConceptSuggestion,
  GraphEdgeCandidate,
  GraphNode,
  GraphSnapshot,
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  MediaDraft,
} from "@actually-learn/shared";

type BuildKnowledgeGraphParams = {
  drafts: MediaDraft[];
  suggestions: ConceptSuggestion[];
  graph: GraphSnapshot;
  edgeCandidates?: GraphEdgeCandidate[];
};

const genericConcepts = new Set([
  "article",
  "articles",
  "curiosity",
  "essay",
  "essays",
  "idea",
  "ideas",
  "image",
  "images",
  "insight",
  "interesting",
  "manual",
  "media",
  "note",
  "notes",
  "personal insight",
  "podcast",
  "podcasts",
  "reflection",
  "reflections",
  "saved",
  "thought",
  "thoughts",
  "tweet",
  "tweets",
  "video",
  "videos",
]);

const genericConceptKeys = new Set(Array.from(genericConcepts, (concept) => normalizeConceptKey(concept)));

export function buildKnowledgeGraph({
  drafts,
  suggestions,
  graph,
  edgeCandidates = [],
}: BuildKnowledgeGraphParams): KnowledgeGraph {
  const savedDrafts = drafts.filter((draft) => draft.status === "saved");
  const conceptsByDraftId = new Map<string, Set<string>>();

  suggestions
    .filter((suggestion) => suggestion.approved)
    .forEach((suggestion) => {
      const bucket = conceptsByDraftId.get(suggestion.sourceDraftId) ?? new Set<string>();
      bucket.add(suggestion.label);
      suggestion.relatedConceptLabels.forEach((label) => bucket.add(label));
      conceptsByDraftId.set(suggestion.sourceDraftId, bucket);
    });

  const conceptLabelsByNodeId = new Map(
    graph.nodes
      .filter((node) => node.kind === "concept")
      .map((node) => [node.id, normalizeGraphLabel(node)]),
  );

  graph.edges.forEach((edge) => {
    const conceptLabel =
      conceptLabelsByNodeId.get(edge.from) ?? conceptLabelsByNodeId.get(edge.to);
    const relatedNodeId = conceptLabelsByNodeId.has(edge.from)
      ? edge.to
      : conceptLabelsByNodeId.has(edge.to)
        ? edge.from
        : null;
    if (!conceptLabel || !relatedNodeId) {
      return;
    }

    const relatedNode = graph.nodes.find((node) => node.id === relatedNodeId);
    if (!relatedNode) {
      return;
    }

    const draft = findDraftForGraphNode(relatedNode, savedDrafts);
    if (!draft) {
      return;
    }

    const bucket = conceptsByDraftId.get(draft.id) ?? new Set<string>();
    bucket.add(conceptLabel);
    conceptsByDraftId.set(draft.id, bucket);
  });

  const nodes: KnowledgeGraphNode[] = savedDrafts.map((draft) => {
    const concepts = mergeConceptLabels(Array.from(conceptsByDraftId.get(draft.id) ?? new Set<string>()));
    return {
      id: draft.id,
      title: draft.preview.title,
      summary: draft.reflection || draft.preview.excerpt || "Imported from Paradigm.",
      reflection: draft.reflection,
      excerpt: draft.preview.excerpt,
      imageAsset: draft.preview.imageAsset,
      domain: draft.preview.domain,
      mediaType: draft.preview.mediaType,
      score: draft.evaluation?.score,
      concepts,
    };
  });

  const conceptFrequency = buildFrequencyMap(
    nodes.flatMap((node) => node.concepts.map((concept) => normalizeConceptKey(concept))).filter(Boolean),
  );
  const keywordFrequency = buildFrequencyMap(
    nodes.flatMap((node) => extractKeywords(toSimilarityText(node))),
  );

  const generatedEdges: KnowledgeGraphEdge[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < nodes.length; compareIndex += 1) {
      const current = nodes[index];
      const other = nodes[compareIndex];
      const score = scoreSimilarity(current, other, conceptFrequency, keywordFrequency);
      if (score.weight < 0.26) {
        continue;
      }

      generatedEdges.push({
        id: `${current.id}:${other.id}`,
        from: current.id,
        to: other.id,
        label:
          score.sharedConcepts.slice(0, 2).join(" · ") ||
          score.sharedKeywords.slice(0, 2).join(" · ") ||
          "related",
        weight: Number(score.weight.toFixed(2)),
        reasons: score.reasons,
      });
    }
  }

  const edges = mergePersistedEdgeCandidates(generatedEdges, edgeCandidates, nodes);
  return { nodes, edges };
}

function mergePersistedEdgeCandidates(
  generatedEdges: KnowledgeGraphEdge[],
  edgeCandidates: GraphEdgeCandidate[],
  nodes: KnowledgeGraphNode[],
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const generatedById = new Map(generatedEdges.map((edge) => [edge.id, edge]));
  const candidateById = new Map(edgeCandidates.map((edge) => [edge.id, edge]));
  const merged = new Map<string, KnowledgeGraphEdge>();

  for (const edge of generatedEdges) {
    const candidate = candidateById.get(edge.id);
    if (candidate?.status === "dismissed") {
      continue;
    }
    merged.set(edge.id, {
      ...edge,
      ...(candidate
        ? {
            label: candidate.label,
            weight: candidate.weight,
            reasons: candidate.reasons,
            status: candidate.status,
          }
        : { status: "suggested" as const }),
    });
  }

  for (const candidate of edgeCandidates) {
    if (
      candidate.status !== "approved" ||
      generatedById.has(candidate.id) ||
      !nodeIds.has(candidate.from) ||
      !nodeIds.has(candidate.to)
    ) {
      continue;
    }
    merged.set(candidate.id, candidate);
  }

  return Array.from(merged.values()).sort((left, right) => right.weight - left.weight);
}

function scoreSimilarity(
  current: KnowledgeGraphNode,
  other: KnowledgeGraphNode,
  conceptFrequency: Map<string, number>,
  keywordFrequency: Map<string, number>,
) {
  const sharedConcepts = intersectConcepts(current.concepts, other.concepts);
  const sharedKeywords = intersect(
    extractKeywords(toSimilarityText(current)),
    extractKeywords(toSimilarityText(other)),
  );

  let weight = 0;
  const reasons: string[] = [];
  const meaningfulConcepts: string[] = [];
  const meaningfulKeywords: string[] = [];

  for (const concept of sharedConcepts) {
    const normalized = normalizeConceptKey(concept);
    const frequency = conceptFrequency.get(normalized) ?? 2;
    const generic = isGenericConcept(concept);
    const contribution = generic
      ? frequency <= 2
        ? 0.05
        : 0.01
      : frequency === 2
        ? 0.42
        : frequency === 3
          ? 0.28
          : 0.18;

    if (contribution >= 0.08) {
      meaningfulConcepts.push(concept);
    }
    weight += contribution;
  }

  for (const keyword of sharedKeywords.slice(0, 4)) {
    const frequency = keywordFrequency.get(normalizeLabel(keyword)) ?? 2;
    const contribution = frequency === 2 ? 0.12 : frequency === 3 ? 0.08 : 0.04;
    if (contribution >= 0.08) {
      meaningfulKeywords.push(keyword);
    }
    weight += contribution;
  }

  if (meaningfulConcepts.length > 0) {
    reasons.push(`Shared concept: ${meaningfulConcepts.slice(0, 2).join(", ")}`);
  }

  if (meaningfulKeywords.length > 0) {
    reasons.push(`Shared language: ${meaningfulKeywords.slice(0, 3).join(", ")}`);
  }

  const hasMeaningfulOverlap = meaningfulConcepts.length > 0 || meaningfulKeywords.length >= 2;

  if (hasMeaningfulOverlap && current.domain && other.domain && current.domain === other.domain) {
    weight += 0.08;
    reasons.push(`Same source domain: ${current.domain}`);
  }

  if (
    hasMeaningfulOverlap &&
    current.mediaType &&
    other.mediaType &&
    current.mediaType === other.mediaType
  ) {
    weight += 0.04;
    reasons.push(`Same format: ${current.mediaType}`);
  }

  if (!hasMeaningfulOverlap) {
    weight = 0;
  }

  return {
    weight,
    reasons,
    sharedConcepts: meaningfulConcepts,
    sharedKeywords: meaningfulKeywords,
  };
}

function findDraftForGraphNode(node: GraphNode, drafts: MediaDraft[]) {
  const cleaned = normalizeLabel(normalizeGraphLabel(node));
  return drafts.find((draft) => {
    const titleMatch = normalizeLabel(draft.preview.title) === cleaned;
    const reflectionMatch = normalizeLabel(draft.reflection ?? "").includes(cleaned);
    const labelContainsTitle = cleaned.includes(normalizeLabel(draft.preview.title));
    return titleMatch || reflectionMatch || labelContainsTitle;
  });
}

function normalizeGraphLabel(node: GraphNode) {
  let label = node.label.trim();
  label = label.replace(/^Reflection:\s*/i, "");
  label = label.replace(/(media|reflection|concept)$/i, "");
  return label.trim();
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeConceptKey(value: string) {
  return normalizeConceptPhrase(value).replace(/\s+/g, "");
}

function normalizeConceptPhrase(value: string) {
  const normalized = normalizeLabel(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((token) => singularizeToken(token))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeConceptLabels(values: string[]) {
  const concepts = new Map<string, string>();
  values.forEach((value) => {
    const key = normalizeConceptKey(value);
    if (!key) {
      return;
    }
    const current = concepts.get(key);
    const candidate = formatConceptLabel(value, normalizeConceptPhrase(value));
    if (!current || prefersConceptLabel(candidate, current)) {
      concepts.set(key, candidate);
    }
  });

  return Array.from(concepts.entries())
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([, label]) => label);
}

function isGenericConcept(label: string) {
  return genericConceptKeys.has(normalizeConceptKey(label));
}

function toSimilarityText(node: KnowledgeGraphNode) {
  return [node.title, node.summary, node.reflection, node.excerpt, node.concepts.join(" ")]
    .filter(Boolean)
    .join(" ");
}

function buildFrequencyMap(values: string[]) {
  const map = new Map<string, number>();
  values.forEach((value) => {
    map.set(value, (map.get(value) ?? 0) + 1);
  });
  return map;
}

function extractKeywords(value: string) {
  const stopwords = new Set([
    "about",
    "after",
    "because",
    "being",
    "could",
    "great",
    "their",
    "there",
    "these",
    "those",
    "which",
    "would",
    "this",
    "that",
    "into",
    "through",
    "make",
    "made",
    "more",
    "want",
    "manual",
    "saved",
    "entry",
    "reflection",
    "article",
    "note",
    "personal",
    "insight",
    "ideas",
    "media",
    "worth",
    "remembering",
  ]);

  return Array.from(
    new Set(
      normalizeLabel(value)
        .split(" ")
        .filter((item) => item.length > 3 && !stopwords.has(item)),
    ),
  );
}

function intersect(values: string[], others: string[]) {
  const otherSet = new Set(others.map((item) => normalizeLabel(item)));
  return values.filter((item) => otherSet.has(normalizeLabel(item)));
}

function intersectConcepts(values: string[], others: string[]) {
  const otherMap = new Map(others.map((item) => [normalizeConceptKey(item), item] as const));
  return values.filter((item) => otherMap.has(normalizeConceptKey(item)));
}

function singularizeToken(value: string) {
  if (value.length <= 4) {
    return value;
  }
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("sses")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function formatConceptLabel(raw: string, normalizedKey: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return toTitleCase(normalizedKey);
  }

  if (/\s/.test(trimmed) || /[-_/]/.test(trimmed)) {
    return toTitleCase(normalizedKey);
  }

  return trimmed;
}

function prefersConceptLabel(candidate: string, current: string) {
  const candidateHasSpaces = /\s/.test(candidate);
  const currentHasSpaces = /\s/.test(current);
  if (candidateHasSpaces !== currentHasSpaces) {
    return candidateHasSpaces;
  }
  return candidate.length > current.length;
}

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}
