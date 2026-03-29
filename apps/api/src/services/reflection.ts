import type {
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

export function buildQuizQuestions(
  drafts: MediaDraft[],
  repetitionScoreFor: (draftId: string) => number,
): QuizQuestion[] {
  const saved = drafts.filter((draft) => draft.status === "saved");
  const ranked = saved
    .map((draft) => {
      const ageDays =
        (Date.now() - new Date(draft.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.max(0.1, 10 - ageDays);
      const repetitionWeight = 3 - repetitionScoreFor(draft.id);
      return {
        draft,
        weight: recencyWeight + repetitionWeight,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const questionTypes: QuizQuestion["type"][] = [
    "why_saved",
    "summary_recall",
    "concept_match",
  ];

  return ranked.map(({ draft }, index) => ({
    id: `question-${draft.id}`,
    draftId: draft.id,
    itemTitle: draft.preview.title,
    type: questionTypes[index % questionTypes.length],
    conceptHint: draft.preview.domain,
    prompt:
      index % 3 === 0
        ? `Why did you save "${draft.preview.title}"?`
        : index % 3 === 1
          ? `Write a two-sentence summary of "${draft.preview.title}" in your own words.`
          : `Which concept or theme best links "${draft.preview.title}" to your broader interests?`,
  }));
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
