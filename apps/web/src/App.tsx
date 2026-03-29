import { useEffect, useState } from "react";

import type {
  ConceptSuggestion,
  GraphSnapshot,
  MediaDraft,
  MeResponse,
  QuizResult,
} from "@actually-learn/shared";

import { api } from "./lib/api";

type QuizSession = Awaited<ReturnType<typeof api.createWeeklyQuiz>>;

const initialMe: MeResponse = {
  connected: false,
  permissions: {},
  featureFlags: {
    canReadNodes: false,
    canCreateNodes: false,
    canReadRelationships: false,
    canCreateRelationships: false,
  },
  sync: {
    canSync: false,
    cursorPresent: false,
  },
  stats: {
    savedCount: 0,
    conceptCount: 0,
    pendingSuggestions: 0,
  },
};

export default function App() {
  const [me, setMe] = useState<MeResponse>(initialMe);
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  const [suggestions, setSuggestions] = useState<ConceptSuggestion[]>([]);
  const [graph, setGraph] = useState<GraphSnapshot>({ nodes: [], edges: [] });
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const [prompts, setPrompts] = useState<{ id: string; prompt: string }[]>([]);
  const [status, setStatus] = useState("Ready.");

  async function refreshCore() {
    const [meData, draftData, suggestionData, graphData] = await Promise.all([
      api.getMe(),
      api.listDrafts(),
      api.listConceptSuggestions(),
      api.getGraph(),
    ]);
    setMe(meData);
    setDrafts(draftData.drafts);
    setSuggestions(suggestionData.suggestions);
    setGraph(graphData);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      refreshCore()
        .then(() => setStatus("Connected to Paradigm."))
        .catch((error: Error) => setStatus(error.message))
        .finally(() => {
          window.history.replaceState({}, "", window.location.pathname);
        });
      return;
    }

    if (params.get("auth") === "error") {
      setStatus(params.get("message") ?? "Paradigm authorization failed.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    refreshCore().catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!selectedDraftId) {
      setPrompts([]);
      setSelectedPrompt("");
      return;
    }

    api
      .getPrompts(selectedDraftId)
      .then((result) => setPrompts(result.prompts))
      .catch(() => setPrompts([]));
  }, [selectedDraftId]);

  async function handleConnect() {
    try {
      const result = await api.startAuth();
      setStatus(result.hint);
      if (result.authorizeUrl) {
        window.location.href = result.authorizeUrl;
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to start auth.");
    }
  }

  async function handleCreateDraft(event: React.FormEvent) {
    event.preventDefault();
    try {
      const draft = await api.createPreview({
        url: url || undefined,
        title: title || undefined,
        notes: notes || undefined,
      });
      setUrl("");
      setTitle("");
      setNotes("");
      setSelectedDraftId(draft.id);
      setReflection("");
      setStatus("Draft created. Add a thoughtful sentence before saving.");
      await refreshCore();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create draft.");
    }
  }

  async function handleEvaluate() {
    if (!selectedDraftId) {
      return;
    }
    try {
      const result = await api.evaluateReflection(selectedDraftId, reflection);
      setStatus(result.draft.evaluation?.feedback ?? "Reflection checked.");
      await refreshCore();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to evaluate reflection.");
    }
  }

  async function handleCommit() {
    if (!selectedDraftId) {
      return;
    }
    try {
      await api.commitDraft(selectedDraftId, selectedPrompt || undefined);
      setStatus("Saved to your knowledge graph.");
      setReflection("");
      await refreshCore();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save to graph.");
    }
  }

  async function handleApproveSuggestion(suggestionId: string) {
    try {
      await api.approveConceptSuggestion(suggestionId);
      setStatus("Concept approved and linked.");
      await refreshCore();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to approve concept.");
    }
  }

  async function handleStartQuiz() {
    try {
      const session = await api.createWeeklyQuiz();
      setQuiz(session);
      setQuizAnswers({});
      setQuizResult(null);
      setStatus("Weekly recap ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to generate quiz.");
    }
  }

  async function handleSyncNow() {
    try {
      const result = await api.syncNow();
      await refreshCore();
      setStatus(
        `Sync complete. Imported ${result.importedDrafts} draft${
          result.importedDrafts === 1 ? "" : "s"
        }.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to sync from Paradigm.");
    }
  }

  async function handleSubmitQuiz() {
    if (!quiz) {
      return;
    }
    try {
      for (const question of quiz.questions) {
        await api.answerQuiz(quiz.sessionId, question.id, quizAnswers[question.id] ?? "");
      }
      const result = await api.getQuizResult(quiz.sessionId);
      setQuizResult(result);
      setStatus("Quiz scored.");
      await refreshCore();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to submit quiz.");
    }
  }

  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;

  return (
    <div className="app-shell">
      <aside className="hero">
        <p className="eyebrow">Actually Learn</p>
        <h1>Save less. Reflect more. Remember what changed you.</h1>
        <p className="lede">
          Capture internet media into a user-owned Paradigm graph, but only after you
          explain why it matters.
        </p>
        <div className="stat-grid">
          <Stat label="Saved with reflection" value={String(me.stats.savedCount)} />
          <Stat label="Concepts linked" value={String(me.stats.conceptCount)} />
          <Stat label="Pending links" value={String(me.stats.pendingSuggestions)} />
        </div>
        <div className="actions">
          <button className="primary" onClick={handleConnect}>
            {me.connected ? "Reconnect Paradigm" : "Connect Paradigm"}
          </button>
          <button
            className="secondary"
            onClick={handleSyncNow}
            disabled={!me.sync.canSync}
          >
            Sync now
          </button>
        </div>
        <div className="status-block">
          <p className="status-label">
            {me.connected ? "Connected to Paradigm" : "Not connected"}
          </p>
          <p className="status-label">
            Nodes: {me.featureFlags.canReadNodes ? "read" : "no read"} /{" "}
            {me.featureFlags.canCreateNodes ? "create" : "no create"}
          </p>
          <p className="status-label">
            Relationships: {me.featureFlags.canReadRelationships ? "read" : "no read"} /{" "}
            {me.featureFlags.canCreateRelationships ? "create" : "no create"}
          </p>
          <p className="status-label">
            Last sync: {me.sync.lastSyncedAt ? new Date(me.sync.lastSyncedAt).toLocaleString() : "Not yet"}
          </p>
        </div>
        <p className="status">{status}</p>
      </aside>

      <main className="workspace">
        <section className="panel">
          <h2>Capture</h2>
          <form className="capture-form" onSubmit={handleCreateDraft}>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a URL"
            />
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Or give it a title"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Short excerpt or why you bookmarked it"
              rows={4}
            />
            <button className="primary" type="submit">
              Create draft
            </button>
          </form>
        </section>

        <section className="panel split">
          <div>
            <h2>Drafts</h2>
            <div className="draft-list">
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  className={`draft-card ${selectedDraftId === draft.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedDraftId(draft.id);
                    setReflection(draft.reflection ?? "");
                  }}
                >
                  <span>{draft.preview.title}</span>
                  <small>{draft.status.replaceAll("_", " ")}</small>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2>Reflect</h2>
            {selectedDraft ? (
              <>
                <p className="draft-title">{selectedDraft.preview.title}</p>
                <textarea
                  value={reflection}
                  onChange={(event) => setReflection(event.target.value)}
                  placeholder="Write at least one thoughtful sentence."
                  rows={7}
                />
                <div className="prompt-list">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      className={selectedPrompt === prompt.prompt ? "chip active" : "chip"}
                      onClick={() => {
                        setSelectedPrompt(prompt.prompt);
                        setReflection((current) =>
                          current || `${prompt.prompt} `,
                        );
                      }}
                    >
                      {prompt.prompt}
                    </button>
                  ))}
                </div>
                <div className="actions">
                  <button className="secondary" onClick={handleEvaluate}>
                    Evaluate reflection
                  </button>
                  <button
                    className="primary"
                    onClick={handleCommit}
                    disabled={selectedDraft.status !== "approved_for_save" && !selectedDraft.evaluation?.accepted}
                  >
                    Save to graph
                  </button>
                </div>
                {selectedDraft.evaluation ? (
                  <p className="feedback">
                    Score {selectedDraft.evaluation.score}: {selectedDraft.evaluation.feedback}
                  </p>
                ) : null}
              </>
            ) : (
              <p>Select a draft to write about why it matters.</p>
            )}
          </div>
        </section>

        <section className="panel split">
          <div>
            <h2>Mind map suggestions</h2>
            <div className="suggestions">
              {suggestions.length === 0 ? <p>No suggestions yet.</p> : null}
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="suggestion-card">
                  <strong>{suggestion.label}</strong>
                  <p>{suggestion.rationale}</p>
                  <small>{suggestion.relatedConceptLabels.join(" · ")}</small>
                  <button
                    className="secondary"
                    disabled={suggestion.approved}
                    onClick={() => handleApproveSuggestion(suggestion.id)}
                  >
                    {suggestion.approved ? "Approved" : "Approve link"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2>Graph snapshot</h2>
            <div className="graph-box">
              {graph.nodes.map((node: GraphSnapshot["nodes"][number]) => (
                <div key={node.id} className={`graph-node ${node.kind}`}>
                  <span>{node.label}</span>
                  <small>{node.kind}</small>
                </div>
              ))}
              {graph.nodes.length === 0 ? <p>No graph yet. Save and approve a concept.</p> : null}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <h2>Weekly recap</h2>
              <p>Recent items are favored, but older ones resurface as repetition weakens.</p>
            </div>
            <button className="primary" onClick={handleStartQuiz}>
              Generate quiz
            </button>
          </div>

          {quiz ? (
            <div className="quiz-list">
              {quiz.questions.map((question) => (
                <div key={question.id} className="quiz-card">
                  <strong>{question.prompt}</strong>
                  <textarea
                    rows={4}
                    value={quizAnswers[question.id] ?? ""}
                    onChange={(event) =>
                      setQuizAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <button className="secondary" onClick={handleSubmitQuiz}>
                Score recap
              </button>
            </div>
          ) : null}

          {quizResult ? (
            <div className="result-box">
              <strong>Score: {quizResult.score}</strong>
              <p>
                Reflection streak: {quizResult.streaks.reflectionDays} days. Weekly recaps:
                {" "}
                {quizResult.streaks.weeklyRecaps}.
              </p>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{value}</span>
      <small>{label}</small>
    </div>
  );
}
