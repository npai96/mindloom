const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
async function request(path, init) {
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
    startAuth: () => request("/auth/paradigm/start"),
    completeCallback: (params) => request(`/auth/paradigm/callback?${params.toString()}`),
    getMe: () => request("/me"),
    syncNow: () => request("/sync", {
        method: "POST",
    }),
    createPreview: (payload) => request("/media/preview", {
        method: "POST",
        body: JSON.stringify(payload),
    }),
    listDrafts: () => request("/media/drafts"),
    getPrompts: (draftId) => request("/reflections/prompts", {
        method: "POST",
        body: JSON.stringify({ draftId }),
    }),
    evaluateReflection: (draftId, reflection) => request("/reflections/evaluate", {
        method: "POST",
        body: JSON.stringify({ draftId, reflection }),
    }),
    commitDraft: (draftId, selectedPrompt) => request("/media/commit", {
        method: "POST",
        body: JSON.stringify({ draftId, selectedPrompt }),
    }),
    listConceptSuggestions: () => request("/concepts/suggestions"),
    approveConceptSuggestion: (suggestionId) => request("/concepts/approve", {
        method: "POST",
        body: JSON.stringify({ suggestionId }),
    }),
    getGraph: () => request("/graph"),
    createWeeklyQuiz: () => request("/quiz/weekly"),
    answerQuiz: (quizId, questionId, answer) => request(`/quiz/${quizId}/answer`, {
        method: "POST",
        body: JSON.stringify({ questionId, answer }),
    }),
    getQuizResult: (quizId) => request(`/quiz/${quizId}/result`),
};
