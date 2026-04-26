import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ConceptSuggestion,
  KnowledgeGraph,
  KnowledgeGraphNode,
  MediaDraft,
  MeResponse,
  QuizResult,
} from "@actually-learn/shared";

import { api } from "./lib/api";

type QuizSession = Awaited<ReturnType<typeof api.createWeeklyQuiz>>;
type KnowledgeTab = "graph" | "suggestions";
type EntryTab = "capture" | "reflect";

type GraphDetail = {
  title: string;
  summary: string;
  metaLine?: string;
  scoreLabel?: string;
  concepts: string[];
  sections: Array<{ label: string; content: string }>;
  linkedEntries: Array<{
    id: string;
    title: string;
    label: string;
    reasons: string[];
    weight: number;
  }>;
};

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
  const [knowledgeModel, setKnowledgeModel] = useState<KnowledgeGraph>({
    nodes: [],
    edges: [],
  });
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const [prompts, setPrompts] = useState<{ id: string; prompt: string }[]>([]);
  const [status, setStatus] = useState("Ready.");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>("graph");
  const [entryTab, setEntryTab] = useState<EntryTab>("capture");

  const activeDrafts = useMemo(
    () => drafts.filter((draft) => draft.status !== "saved"),
    [drafts],
  );

  async function refreshCore() {
    const [meData, draftData, suggestionData, knowledgeData] = await Promise.all([
      api.getMe(),
      api.listDrafts(),
      api.listConceptSuggestions(),
      api.getKnowledgeGraph(),
    ]);
    setMe(meData);
    setDrafts(draftData.drafts);
    setSuggestions(suggestionData.suggestions);
    setKnowledgeModel(knowledgeData);
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
    if (!selectedDraftId || !activeDrafts.some((draft) => draft.id === selectedDraftId)) {
      const nextDraft = activeDrafts[0] ?? null;
      setSelectedDraftId(nextDraft?.id ?? null);
      setReflection(nextDraft?.reflection ?? "");
      setSelectedPrompt(nextDraft?.selectedPrompt ?? "");
    }
  }, [activeDrafts, selectedDraftId]);

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

  useEffect(() => {
    if (
      !selectedGraphNodeId ||
      !knowledgeModel.nodes.some((node) => node.id === selectedGraphNodeId)
    ) {
      setSelectedGraphNodeId(knowledgeModel.nodes[0]?.id ?? null);
    }
  }, [knowledgeModel.nodes, selectedGraphNodeId]);

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
      setEntryTab("reflect");
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
      setSelectedPrompt("");
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
      setKnowledgeTab("graph");
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
      setCurrentQuizIndex(0);
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

  const selectedDraft = activeDrafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const selectedGraphNode =
    knowledgeModel.nodes.find((node) => node.id === selectedGraphNodeId) ??
    knowledgeModel.nodes[0] ??
    null;
  const graphDetail = selectedGraphNode
    ? resolveKnowledgeDetail(selectedGraphNode, knowledgeModel)
    : null;
  const sortedSuggestions = [...suggestions].sort((left, right) => {
    if (left.approved !== right.approved) {
      return Number(left.approved) - Number(right.approved);
    }
    return left.label.localeCompare(right.label);
  });
  const activeQuizQuestion = quiz?.questions[currentQuizIndex] ?? null;
  const answeredQuizCount = quiz
    ? quiz.questions.filter((question) => (quizAnswers[question.id] ?? "").trim().length > 0).length
    : 0;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="hero">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? "→" : "←"}
        </button>

        {sidebarCollapsed ? (
          <div className="hero-collapsed">
            <div className="collapsed-mark">M</div>
            <button
              className="primary compact icon-button"
              onClick={handleConnect}
              aria-label={me.connected ? "Reconnect Paradigm" : "Connect Paradigm"}
              title={me.connected ? "Reconnect Paradigm" : "Connect Paradigm"}
            >
              ↺
            </button>
            <button
              className="secondary compact icon-button"
              onClick={handleSyncNow}
              disabled={!me.sync.canSync}
              aria-label="Sync now"
              title="Sync now"
            >
              ⟳
            </button>
            <div className="collapsed-stats">
              <StatMini label="Saved" value={String(me.stats.savedCount)} />
              <StatMini label="Ideas" value={String(me.stats.conceptCount)} />
            </div>
          </div>
        ) : (
          <>
            <p className="eyebrow">Mindloom</p>
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
                Last sync:{" "}
                {me.sync.lastSyncedAt ? new Date(me.sync.lastSyncedAt).toLocaleString() : "Not yet"}
              </p>
            </div>
            <p className="status">{status}</p>
          </>
        )}
      </aside>

      <main className="workspace">
        <section className="panel entry-panel">
          <div className="section-header">
            <div>
              <h2>Entry studio</h2>
              <p className="subtle">
                Capture quickly, then switch into reflection mode without leaving the workspace.
              </p>
            </div>
            <div className="tab-row">
              <button
                className={`tab-button ${entryTab === "capture" ? "active" : ""}`}
                onClick={() => setEntryTab("capture")}
              >
                Data entry
              </button>
              <button
                className={`tab-button ${entryTab === "reflect" ? "active" : ""}`}
                onClick={() => setEntryTab("reflect")}
              >
                Reflect
              </button>
            </div>
          </div>

          {entryTab === "capture" ? (
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
          ) : (
            <div className="workbench">
              <aside className="workbench-sidebar">
                <div className="workbench-sidebar-copy">
                  <strong>Draft queue</strong>
                  <p className="subtle">
                    Unsaved drafts stay here. Saved items move into the graph.
                  </p>
                </div>
                <div className="draft-scroll">
                  {activeDrafts.length === 0 ? (
                    <div className="empty-state">
                      <strong>No active drafts</strong>
                      <p>Capture something new to start another reflection.</p>
                    </div>
                  ) : null}

                  {activeDrafts.map((draft) => (
                    <button
                      key={draft.id}
                      className={`draft-card ${selectedDraftId === draft.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedDraftId(draft.id);
                        setReflection(draft.reflection ?? "");
                        setSelectedPrompt(draft.selectedPrompt ?? "");
                      }}
                    >
                      <span className="draft-title">{draft.preview.title}</span>
                      <small>{draft.preview.domain || draft.preview.mediaType}</small>
                      <small>{draft.status.replaceAll("_", " ")}</small>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="workbench-main">
                {selectedDraft ? (
                  <div className="reflect-shell">
                    <div className="selected-draft-summary">
                      <strong>{selectedDraft.preview.title}</strong>
                      <p>{selectedDraft.preview.excerpt || "No excerpt captured yet."}</p>
                    </div>
                    <textarea
                      value={reflection}
                      onChange={(event) => setReflection(event.target.value)}
                      placeholder="Write at least one thoughtful sentence."
                      rows={8}
                    />
                    <div className="prompt-list">
                      {prompts.map((prompt) => (
                        <button
                          key={prompt.id}
                          className={selectedPrompt === prompt.prompt ? "chip active" : "chip"}
                          onClick={() => {
                            setSelectedPrompt(prompt.prompt);
                            setReflection((current) => current || `${prompt.prompt} `);
                          }}
                        >
                          {prompt.prompt}
                        </button>
                      ))}
                    </div>
                    <div className="actions">
                      <button className="tertiary" onClick={handleEvaluate}>
                        Evaluate reflection
                      </button>
                      <button
                        className="primary"
                        onClick={handleCommit}
                        disabled={
                          selectedDraft.status !== "approved_for_save" &&
                          !selectedDraft.evaluation?.accepted
                        }
                      >
                        Save to graph
                      </button>
                    </div>
                    {selectedDraft.evaluation ? (
                      <p className="feedback">
                        Score {selectedDraft.evaluation.score}: {selectedDraft.evaluation.feedback}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>Nothing waiting for reflection</strong>
                    <p>Select a draft from the left or create a new one in Data entry.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel knowledge-panel">
          <div className="section-header">
            <div>
              <h2>Knowledge space</h2>
              <p className="subtle">
                Explore the saved graph or approve pending concept links without splitting your attention.
              </p>
            </div>
            <div className="tab-row">
              <button
                className={`tab-button ${knowledgeTab === "graph" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("graph")}
              >
                Graph
              </button>
              <button
                className={`tab-button ${knowledgeTab === "suggestions" ? "active" : ""}`}
                onClick={() => setKnowledgeTab("suggestions")}
              >
                Suggestions
              </button>
            </div>
          </div>

          {knowledgeTab === "graph" ? (
            knowledgeModel.nodes.length === 0 ? (
              <div className="empty-state">
                <strong>No graph yet</strong>
                <p>Save a reflected item and approve a concept to start weaving the map.</p>
              </div>
            ) : (
              <GraphExplorer
                model={knowledgeModel}
                selectedNodeId={selectedGraphNode?.id ?? null}
                onSelectNode={setSelectedGraphNodeId}
                detail={graphDetail}
              />
            )
          ) : (
            <div className="suggestions-grid">
              {suggestions.length === 0 ? (
                <div className="empty-state">
                  <strong>No suggestions yet</strong>
                  <p>Once reflections are saved, Mindloom will suggest concept threads here.</p>
                </div>
              ) : null}
              {sortedSuggestions.map((suggestion) => {
                const sourceDraft = drafts.find((draft) => draft.id === suggestion.sourceDraftId);
                return (
                  <div key={suggestion.id} className="suggestion-card">
                    <div className="suggestion-topline">
                      <div className="suggestion-heading">
                        <strong>{suggestion.label}</strong>
                        {sourceDraft ? <small>From {sourceDraft.preview.title}</small> : null}
                      </div>
                      <span className="pill subtle-pill">
                        {suggestion.approved ? "Approved" : "Pending"}
                      </span>
                    </div>
                    <p>{suggestion.rationale}</p>
                    {suggestion.relatedConceptLabels.length > 0 ? (
                      <div className="detail-meta">
                        {suggestion.relatedConceptLabels.map((item) => (
                          <span key={item} className="meta-chip">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="suggestion-actions">
                      <button
                        className="secondary"
                        disabled={suggestion.approved}
                        onClick={() => handleApproveSuggestion(suggestion.id)}
                      >
                        {suggestion.approved ? "Approved" : "Approve link"}
                      </button>
                      {sourceDraft && sourceDraft.status === "saved" ? (
                        <button
                          className="tertiary"
                          onClick={() => {
                            setKnowledgeTab("graph");
                            setSelectedGraphNodeId(sourceDraft.id);
                          }}
                        >
                          View entry
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-header">
            <div>
              <h2>Weekly recap</h2>
              <p className="subtle">
                Recent items are favored, but older ones resurface as repetition weakens.
              </p>
            </div>
            <button className="primary" onClick={handleStartQuiz}>
              Generate quiz
            </button>
          </div>

          {quiz ? (
            <div className="quiz-flow">
              <div className="quiz-progress-row">
                <div>
                  <strong>
                    Question {currentQuizIndex + 1} of {quiz.questions.length}
                  </strong>
                  <p className="subtle">
                    {answeredQuizCount} answered so far. Short, specific recall beats perfect prose.
                  </p>
                </div>
                <span className="pill subtle-pill">
                  {activeQuizQuestion ? formatQuizType(activeQuizQuestion.type) : "Recap"}
                </span>
              </div>

              {activeQuizQuestion ? (
                <div className="quiz-card active">
                  <small className="count-label">{activeQuizQuestion.itemTitle}</small>
                  <strong>{activeQuizQuestion.prompt}</strong>
                  <textarea
                    rows={6}
                    value={quizAnswers[activeQuizQuestion.id] ?? ""}
                    onChange={(event) =>
                      setQuizAnswers((current) => ({
                        ...current,
                        [activeQuizQuestion.id]: event.target.value,
                      }))
                    }
                    placeholder="Write what you remember, why you saved it, or how it connects."
                  />
                  <div className="quiz-actions">
                    <button
                      className="secondary"
                      onClick={() => setCurrentQuizIndex((current) => Math.max(0, current - 1))}
                      disabled={currentQuizIndex === 0}
                    >
                      Previous
                    </button>
                    <div className="quiz-actions-right">
                      {currentQuizIndex < quiz.questions.length - 1 ? (
                        <button
                          className="secondary"
                          onClick={() =>
                            setCurrentQuizIndex((current) =>
                              Math.min(quiz.questions.length - 1, current + 1),
                            )
                          }
                        >
                          Next question
                        </button>
                      ) : null}
                      <button className="primary" onClick={handleSubmitQuiz}>
                        Score recap
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {quizResult ? (
            <div className="quiz-result-stack">
              <div className="result-box">
                <strong>Score: {quizResult.score}</strong>
                <p>
                  Reflection streak: {quizResult.streaks.reflectionDays} days. Weekly recaps:
                  {" "}
                  {quizResult.streaks.weeklyRecaps}.
                </p>
              </div>
              <div className="quiz-review-list">
                {quizResult.questions.map((question, index) => (
                  <div key={question.id} className="quiz-review-card">
                    <div className="quiz-review-topline">
                      <small>
                        Question {index + 1} · {question.itemTitle}
                      </small>
                      <span className={`pill ${question.correct ? "success-pill" : "warning-pill"}`}>
                        {question.correct ? "Strong recall" : "Needs another pass"}
                      </span>
                    </div>
                    <strong>{question.prompt}</strong>
                    <div className="detail-section">
                      <small>Your answer</small>
                      <p>{question.userAnswer || "No answer recorded."}</p>
                    </div>
                    <div className="detail-section">
                      <small>Feedback</small>
                      <p>{question.feedback}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function GraphExplorer({
  model,
  selectedNodeId,
  onSelectNode,
  detail,
}: {
  model: KnowledgeGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  detail: GraphDetail | null;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(760);
  const [browserQuery, setBrowserQuery] = useState("");

  useEffect(() => {
    const updateWidth = () => {
      const nextWidth = viewportRef.current?.clientWidth ?? 760;
      setViewportWidth(Math.max(420, nextWidth));
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const { positions, stageWidth, stageHeight } = layoutKnowledgeGraph(model, viewportWidth);
  const filteredNodes = model.nodes
    .filter((node) => {
      const query = browserQuery.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return [node.title, node.summary, node.concepts.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => {
      const leftDegree = model.edges.filter((edge) => edge.from === left.id || edge.to === left.id).length;
      const rightDegree = model.edges.filter((edge) => edge.from === right.id || edge.to === right.id).length;
      if (rightDegree !== leftDegree) {
        return rightDegree - leftDegree;
      }
      return left.title.localeCompare(right.title);
    });

  return (
    <div className="graph-explorer">
      <aside className="graph-browser-panel">
        <div className="graph-browser-copy">
          <strong>Saved entries</strong>
          <p>Browse what you have already reflected on and jump straight into the graph.</p>
        </div>
        <input
          value={browserQuery}
          onChange={(event) => setBrowserQuery(event.target.value)}
          placeholder="Search titles, notes, or themes"
        />
        <div className="graph-browser-list">
          {filteredNodes.map((node) => {
            const connectionCount = model.edges.filter(
              (edge) => edge.from === node.id || edge.to === node.id,
            ).length;
            const isSelected = node.id === selectedNodeId;
            return (
              <button
                key={node.id}
                type="button"
                className={`graph-browser-item ${isSelected ? "active" : ""}`}
                onClick={() => onSelectNode(node.id)}
              >
                <div className="graph-browser-topline">
                  <strong>{node.title}</strong>
                  {typeof node.score === "number" ? (
                    <span>{Math.round(node.score * 100)}</span>
                  ) : null}
                </div>
                <p>{truncateLabel(node.summary, 88)}</p>
                <small>
                  {connectionCount} link{connectionCount === 1 ? "" : "s"}
                  {node.concepts.length > 0 ? ` · ${node.concepts.slice(0, 2).join(" · ")}` : ""}
                </small>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="graph-stage-card">
        <div className="graph-copy">
          <strong>Each node is a saved idea.</strong>
          <p>Edges appear when entries share concepts or meaningful language.</p>
        </div>

        <div ref={viewportRef} className="graph-stage-viewport">
          <div
            className="graph-stage"
            style={{ width: `${stageWidth}px`, minHeight: `${stageHeight}px` }}
          >
            {model.edges.length === 0 ? (
              <div className="graph-empty-hint">
                <strong>No strong links yet.</strong>
                <p>More specific concepts will make the map denser.</p>
              </div>
            ) : null}
            <svg
              className="graph-lines"
              viewBox={`0 0 ${stageWidth} ${stageHeight}`}
              preserveAspectRatio="none"
            >
              {model.edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) {
                  return null;
                }
                const isActive =
                  selectedNodeId === null ||
                  edge.from === selectedNodeId ||
                  edge.to === selectedNodeId;
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={`graph-edge-line ${isActive ? "active" : "muted"}`}
                  />
                );
              })}
            </svg>

            {model.nodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) {
                return null;
              }

              const isSelected = node.id === selectedNodeId;
              const linkedToSelection = model.edges.some(
                (edge) =>
                  (edge.from === selectedNodeId && edge.to === node.id) ||
                  (edge.to === selectedNodeId && edge.from === node.id),
              );
              const emphasized = selectedNodeId === null || isSelected || linkedToSelection;
              return (
                <button
                  key={node.id}
                  className={`knowledge-node ${isSelected ? "selected" : ""} ${
                    emphasized ? "emphasized" : "muted"
                  }`}
                  style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                  }}
                  onClick={() => onSelectNode(node.id)}
                  title={node.summary}
                  aria-label={node.title}
                >
                  <span className="knowledge-node-mark">{getInitials(node.title)}</span>
                  {typeof node.score === "number" ? (
                    <span className="knowledge-score">{Math.round(node.score * 100)}</span>
                  ) : null}
                  <strong>{truncateLabel(node.title, 34)}</strong>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="graph-detail-panel">
        {detail ? (
          <>
            <div className="detail-header">
              <span className="kind-tag entry">Entry</span>
              <strong>{detail.title}</strong>
            </div>
            <p className="detail-summary">{detail.summary}</p>
            <div className="detail-sections">
              {detail.sections.map((section) => (
                <div key={section.label} className="detail-section">
                  <small>{section.label}</small>
                  <p>{section.content}</p>
                </div>
              ))}
            </div>
            {detail.scoreLabel ? <p className="detail-score">{detail.scoreLabel}</p> : null}
            {detail.metaLine ? (
              <p className="detail-meta-line">{detail.metaLine}</p>
            ) : null}
            {detail.concepts.length > 0 ? (
              <div className="detail-section">
                <small>Shared themes</small>
                <div className="detail-meta">
                  {detail.concepts.map((item) => (
                    <span key={item} className="meta-chip">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {detail.linkedEntries.length > 0 ? (
              <div className="detail-section">
                <small>Why linked</small>
                <div className="linked-entry-list">
                  {detail.linkedEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="linked-entry-card"
                      onClick={() => onSelectNode(entry.id)}
                    >
                      <div className="linked-entry-header">
                        <strong>{entry.title}</strong>
                        <span>{Math.round(entry.weight * 100)}</span>
                      </div>
                      <p>{entry.label}</p>
                      <div className="detail-meta">
                        {entry.reasons.map((reason) => (
                          <span key={reason} className="meta-chip">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state compact">
            <strong>Select a node</strong>
            <p>Click any point in the graph to open the source, reflection, or concept details.</p>
          </div>
        )}
      </aside>
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

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-mini">
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function layoutKnowledgeGraph(model: KnowledgeGraph, viewportWidth: number) {
  const stageWidth = Math.max(viewportWidth, 980);
  const positions = new Map<string, { x: number; y: number }>();
  const nodeIds = model.nodes.map((node) => node.id);
  const adjacency = new Map<string, string[]>();
  nodeIds.forEach((id) => adjacency.set(id, []));
  model.edges.forEach((edge) => {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  });

  const visited = new Set<string>();
  const components: string[][] = [];
  nodeIds.forEach((id) => {
    if (visited.has(id)) {
      return;
    }
    const queue = [id];
    const component: string[] = [];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      component.push(current);
      (adjacency.get(current) ?? []).forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }
    components.push(component);
  });

  let xCursor = 120;
  let yCursor = 120;
  let rowHeight = 0;
  const horizontalGap = 56;
  const verticalGap = 92;

  components.forEach((component) => {
    const clusterRadius = component.length <= 1 ? 0 : Math.max(150, component.length * 36);
    const clusterWidth = component.length <= 1 ? 220 : clusterRadius * 2 + 180;
    const clusterHeight = component.length <= 1 ? 190 : clusterRadius * 2 + 180;

    if (xCursor + clusterWidth > stageWidth - 80) {
      xCursor = 120;
      yCursor += rowHeight + verticalGap;
      rowHeight = 0;
    }

    const centerX = xCursor + clusterWidth / 2;
    const centerY = yCursor + clusterHeight / 2;

    if (component.length === 1) {
      positions.set(component[0], { x: centerX, y: centerY });
    } else {
      component.forEach((id, index) => {
        const angle = (Math.PI * 2 * index) / component.length - Math.PI / 2;
        positions.set(id, {
          x: centerX + Math.cos(angle) * clusterRadius,
          y: centerY + Math.sin(angle) * clusterRadius,
        });
      });
    }

    xCursor += clusterWidth + horizontalGap;
    rowHeight = Math.max(rowHeight, clusterHeight);
  });

  const stageHeight = Math.max(yCursor + rowHeight + 120, 460);

  if (positions.size > 0) {
    const allPositions = Array.from(positions.values());
    const minX = Math.min(...allPositions.map((position) => position.x));
    const maxX = Math.max(...allPositions.map((position) => position.x));
    const minY = Math.min(...allPositions.map((position) => position.y));
    const maxY = Math.max(...allPositions.map((position) => position.y));
    const usedWidth = maxX - minX;
    const usedHeight = maxY - minY;
    const shiftX = stageWidth / 2 - (minX + usedWidth / 2);
    const shiftY = stageHeight / 2 - (minY + usedHeight / 2);

    positions.forEach((position, id) => {
      positions.set(id, {
        x: position.x + shiftX,
        y: position.y + shiftY,
      });
    });
  }

  return { positions, stageWidth, stageHeight };
}

function resolveKnowledgeDetail(node: KnowledgeGraphNode, model: KnowledgeGraph): GraphDetail {
  const linkedEntries = model.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const relatedId = edge.from === node.id ? edge.to : edge.from;
      const relatedNode = model.nodes.find((candidate) => candidate.id === relatedId);
      if (!relatedNode) {
        return null;
      }
      return {
        id: relatedNode.id,
        title: relatedNode.title,
        label: edge.label,
        reasons: edge.reasons,
        weight: edge.weight,
      };
    })
    .filter(
      (
        entry,
      ): entry is { id: string; title: string; label: string; reasons: string[]; weight: number } =>
        Boolean(entry),
    )
    .sort((left, right) => right.weight - left.weight);

  return {
    title: node.title,
    summary: node.excerpt || "No source notes captured yet.",
    metaLine: compact([node.domain, node.mediaType, "saved"]).join(" · "),
    scoreLabel:
      typeof node.score === "number" ? `Reflection score ${Math.round(node.score * 100)}/100` : undefined,
    concepts: node.concepts,
    sections: compactSections([
      section("Why it mattered", node.reflection),
    ]),
    linkedEntries,
  };
}

function truncateLabel(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function compact(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

function section(label: string, content?: string) {
  return content ? { label, content } : undefined;
}

function compactSections(
  sections: Array<{ label: string; content: string } | undefined>,
): Array<{ label: string; content: string }> {
  return sections.filter((item): item is { label: string; content: string } => Boolean(item));
}

function formatQuizType(value: string) {
  switch (value) {
    case "summary_recall":
      return "Summary recall";
    case "why_saved":
      return "Why saved";
    case "concept_match":
      return "Concept match";
    default:
      return "Recap";
  }
}
