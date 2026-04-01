import type {
  ConceptSuggestion,
  GraphSnapshot,
  KnowledgeGraph,
  MediaDraft,
  MeResponse,
  QuizResult,
} from "@actually-learn/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: "Request failed" } }));
    throw new Error(body.error?.message ?? "Request failed");
  }

  return response.json();
}

export const api = {
  startAuth: () => request<{ authorizeUrl?: string; mode: string; hint: string }>("/auth/paradigm/start"),
  completeCallback: (params: URLSearchParams) =>
    request(`/auth/paradigm/callback?${params.toString()}`),
  getMe: () => request<MeResponse>("/me"),
  syncNow: () =>
    request<{ ok: boolean; importedDrafts: number; cursor?: string }>("/sync", {
      method: "POST",
    }),
  createPreview: (payload: { url?: string; title?: string; notes?: string }) =>
    request<MediaDraft>("/media/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listDrafts: () => request<{ drafts: MediaDraft[] }>("/media/drafts"),
  getPrompts: (draftId: string) =>
    request<{ prompts: { id: string; prompt: string }[] }>("/reflections/prompts", {
      method: "POST",
      body: JSON.stringify({ draftId }),
    }),
  evaluateReflection: (draftId: string, reflection: string) =>
    request<{ draft: MediaDraft }>("/reflections/evaluate", {
      method: "POST",
      body: JSON.stringify({ draftId, reflection }),
    }),
  commitDraft: (draftId: string, selectedPrompt?: string) =>
    request("/media/commit", {
      method: "POST",
      body: JSON.stringify({ draftId, selectedPrompt }),
    }),
  listConceptSuggestions: () =>
    request<{ suggestions: ConceptSuggestion[] }>("/concepts/suggestions"),
  approveConceptSuggestion: (suggestionId: string) =>
    request("/concepts/approve", {
      method: "POST",
      body: JSON.stringify({ suggestionId }),
    }),
  getGraph: () => request<GraphSnapshot>("/graph"),
  getKnowledgeGraph: () => request<KnowledgeGraph>("/knowledge-graph"),
  createWeeklyQuiz: () =>
    request<{
      sessionId: string;
      createdAt: string;
      questions: {
        id: string;
        prompt: string;
        type: string;
        draftId: string;
        itemTitle: string;
        conceptHint?: string;
      }[];
    }>("/quiz/weekly"),
  answerQuiz: (quizId: string, questionId: string, answer: string) =>
    request(`/quiz/${quizId}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionId, answer }),
    }),
  getQuizResult: (quizId: string) => request<QuizResult>(`/quiz/${quizId}/result`),
};
