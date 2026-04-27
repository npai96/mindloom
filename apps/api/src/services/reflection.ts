import type {
  ConceptSuggestion,
  MediaDraft,
  QuizQuestion,
  ReflectionEvaluation,
  ReflectionPrompt,
} from "@actually-learn/shared";

function splitSentences(input: string) {
  return input
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function evaluateReflection(reflection: string): ReflectionEvaluation {
  const normalized = reflection.trim();
  const sentences = splitSentences(normalized);
  const lower = normalized.toLowerCase();
  const specificWords = [
    "because",
    "reminds",
    "question",
    "tension",
    "idea",
    "surprised",
    "curious",
    "useful",
    "important",
    "want",
  ];
  const summaryOnlyPhrases = [
    "this is about",
    "it talks about",
    "it is about",
    "summary",
  ];

  const hasPersonalReason = /(i |my |me )/.test(` ${lower} `) || lower.includes("because");
  const hasSpecificity = specificWords.some((word) => lower.includes(word));
  const avoidsSummaryOnly = !summaryOnlyPhrases.some((phrase) => lower.includes(phrase));
  const sentenceCount = sentences.length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  const score =
    (hasPersonalReason ? 0.45 : 0) +
    (hasSpecificity ? 0.3 : 0) +
    (avoidsSummaryOnly ? 0.15 : 0) +
    (sentenceCount >= 1 && wordCount >= 10 ? 0.1 : 0);

  const accepted = sentenceCount >= 1 && wordCount >= 10 && score >= 0.65;
  const feedback = accepted
    ? "Strong reflection. You explained why the item matters to you, not just what it says."
    : "Add one specific sentence about why this matters to you personally, what tension it creates, or what you want to revisit later.";

  return {
    accepted,
    score: Number(score.toFixed(2)),
    feedback,
    rubric: {
      hasPersonalReason,
      hasSpecificity,
      avoidsSummaryOnly,
    },
  };
}

export function generateReflectionPrompts(preview: MediaDraft["preview"]): ReflectionPrompt[] {
  const seeds = [
    `Why did "${preview.title}" catch your attention right now?`,
    `What idea from ${preview.domain} feels worth remembering a month from now?`,
    `How does this connect to a question, project, or tension already on your mind?`,
  ];

  return seeds.map((prompt, index) => ({
    id: `prompt-${index + 1}`,
    prompt,
  }));
}

export function buildConceptSuggestionCandidate(
  draft: MediaDraft,
): Pick<ConceptSuggestion, "label" | "rationale" | "relatedConceptLabels"> {
  return buildConceptSuggestionCandidates(draft)[0] ?? {
    label: toTitleCase(fallbackConceptLabel(draft.preview.domain, draft.preview.mediaType)),
    rationale: "This entry has a general theme worth revisiting later.",
    relatedConceptLabels: [toTitleCase(draft.preview.mediaType)],
  };
}

export function buildConceptSuggestionCandidates(
  draft: MediaDraft,
): Array<Pick<ConceptSuggestion, "label" | "rationale" | "relatedConceptLabels" | "evidence">> {
  const phrases = extractMeaningfulPhrases([
    draft.preview.title,
    draft.reflection,
    draft.preview.excerpt,
  ]);
  const sourcePhrases = extractMeaningfulPhrases([draft.preview.title, draft.preview.excerpt]);
  const reflectionPhrases = extractMeaningfulPhrases([draft.reflection]);
  const labels = Array.from(
    new Set([
      ...phrases.slice(0, 3),
      fallbackConceptLabel(draft.preview.domain, draft.preview.mediaType),
    ]),
  )
    .filter((phrase) => !isGenericConcept(phrase))
    .slice(0, 3);

  return labels.map((phrase) => {
    const label = toTitleCase(phrase);
    const relatedConceptLabels = phrases
      .filter((candidate) => normalizePhrase(candidate) !== normalizePhrase(label))
      .slice(0, 3)
      .map((candidate) => toTitleCase(candidate));
    const sourcePhrase =
      sourcePhrases.find((candidate) => normalizePhrase(candidate) === normalizePhrase(phrase)) ??
      sourcePhrases[0];
    const reflectionPhrase =
      reflectionPhrases.find((candidate) => normalizePhrase(candidate) === normalizePhrase(phrase)) ??
      reflectionPhrases[0];

    return {
      label,
      rationale: `This entry seems to orbit ${label.toLowerCase()} in a way worth revisiting later.`,
      relatedConceptLabels:
        relatedConceptLabels.length > 0
          ? relatedConceptLabels
          : [toTitleCase(draft.preview.mediaType)],
      evidence: {
        sourcePhrase: sourcePhrase ? toTitleCase(sourcePhrase) : undefined,
        reflectionPhrase: reflectionPhrase ? toTitleCase(reflectionPhrase) : undefined,
        reason:
          sourcePhrase && reflectionPhrase
            ? "The concept appears in both the captured material and your reflection."
            : "The concept was extracted from the strongest non-generic language in this entry.",
      },
    };
  });
}

export function buildQuizQuestions(
  drafts: MediaDraft[],
  repetitionScoreFor: (draftId: string) => number,
  contextFor: (draftId: string) => { concepts: string[]; edgeCount: number } = () => ({
    concepts: [],
    edgeCount: 0,
  }),
): QuizQuestion[] {
  const saved = drafts.filter((draft) => draft.status === "saved");
  const ranked = saved
    .map((draft) => {
      const ageDays =
        (Date.now() - new Date(draft.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.max(0.1, 10 - ageDays);
      const repetitionWeight = 3 - repetitionScoreFor(draft.id);
      const context = contextFor(draft.id);
      const graphWeight = Math.min(2, context.edgeCount * 0.4) + Math.min(1.5, context.concepts.length * 0.3);
      return {
        draft,
        context,
        weight: recencyWeight + repetitionWeight + graphWeight,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const questionTypes: QuizQuestion["type"][] = [
    "why_saved",
    "summary_recall",
    "concept_match",
  ];

  return ranked.map(({ draft, context }, index) => {
    const conceptHint = context.concepts[0] ?? draft.preview.domain;
    return {
      id: `question-${draft.id}`,
      draftId: draft.id,
      itemTitle: draft.preview.title,
      type: questionTypes[index % questionTypes.length],
      conceptHint,
      prompt:
        index % 3 === 0
          ? `Why did you save "${draft.preview.title}"?`
          : index % 3 === 1
            ? `Write a two-sentence summary of "${draft.preview.title}" in your own words.`
            : `Which concept or theme best links "${draft.preview.title}" to ${
                conceptHint ? `"${conceptHint}"` : "your broader interests"
              }?`,
    };
  });
}

export function scoreQuizAnswer(question: QuizQuestion, answer: string) {
  const normalized = answer.trim().toLowerCase();
  const lengthOkay = normalized.split(/\s+/).filter(Boolean).length >= 6;
  const keywordMatch =
    normalized.includes(question.itemTitle.toLowerCase().split(" ")[0]) ||
    (question.conceptHint ? normalized.includes(question.conceptHint.toLowerCase()) : false);

  const correct = lengthOkay || keywordMatch;
  return {
    correct,
    feedback: correct
      ? "Nice recall. You retrieved enough detail to strengthen the memory."
      : "Try anchoring your answer to why it mattered, not just the source.",
  };
}

function extractMeaningfulPhrases(values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(" ");
  if (!text.trim()) {
    return [];
  }

  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  const stopwords = new Set([
    "about",
    "after",
    "article",
    "because",
    "being",
    "caught",
    "could",
    "entry",
    "essay",
    "feel",
    "from",
    "have",
    "idea",
    "important",
    "insight",
    "into",
    "item",
    "just",
    "made",
    "manual",
    "more",
    "note",
    "saved",
    "systems",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "want",
    "what",
    "when",
    "which",
    "worth",
    "would",
    "your",
  ]);

  const phrases: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const first = singularizeToken(tokens[index]);
    const second = tokens[index + 1] ? singularizeToken(tokens[index + 1]) : undefined;
    if (
      second &&
      first.length >= 4 &&
      second.length >= 4 &&
      !stopwords.has(first) &&
      !stopwords.has(second)
    ) {
      phrases.push(`${first} ${second}`);
    }

    if (first.length >= 5 && !stopwords.has(first)) {
      phrases.push(first);
    }
  }

  return Array.from(new Set(phrases))
    .filter((phrase) => !isGenericConcept(phrase))
    .slice(0, 4);
}

function fallbackConceptLabel(domain: string, mediaType: string) {
  if (domain && domain !== "manual" && domain !== "unknown") {
    return domain.split(".")[0] ?? mediaType;
  }
  return mediaType === "note" ? "Personal Reflection" : mediaType;
}

function isGenericConcept(value: string) {
  return new Set([
    "article",
    "essay",
    "idea",
    "insight",
    "manual",
    "media",
    "note",
    "personal insight",
    "reflection",
    "saved",
    "video",
  ]).has(normalizePhrase(value));
}

function normalizePhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeToken(value: string) {
  if (value.length <= 4) {
    return value;
  }
  if (value.endsWith("ous") || value.endsWith("us") || value.endsWith("is")) {
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

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}
