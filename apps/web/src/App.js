import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
const initialMe = {
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
    const [me, setMe] = useState(initialMe);
    const [drafts, setDrafts] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [graph, setGraph] = useState({ nodes: [], edges: [] });
    const [quiz, setQuiz] = useState(null);
    const [quizAnswers, setQuizAnswers] = useState({});
    const [quizResult, setQuizResult] = useState(null);
    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const [notes, setNotes] = useState("");
    const [selectedDraftId, setSelectedDraftId] = useState(null);
    const [reflection, setReflection] = useState("");
    const [selectedPrompt, setSelectedPrompt] = useState("");
    const [prompts, setPrompts] = useState([]);
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
                .catch((error) => setStatus(error.message))
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
        refreshCore().catch((error) => setStatus(error.message));
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Failed to start auth.");
        }
    }
    async function handleCreateDraft(event) {
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
        }
        catch (error) {
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
        }
        catch (error) {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Failed to save to graph.");
        }
    }
    async function handleApproveSuggestion(suggestionId) {
        try {
            await api.approveConceptSuggestion(suggestionId);
            setStatus("Concept approved and linked.");
            await refreshCore();
        }
        catch (error) {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Failed to generate quiz.");
        }
    }
    async function handleSyncNow() {
        try {
            const result = await api.syncNow();
            await refreshCore();
            setStatus(`Sync complete. Imported ${result.importedDrafts} draft${result.importedDrafts === 1 ? "" : "s"}.`);
        }
        catch (error) {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Failed to submit quiz.");
        }
    }
    const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "hero", children: [_jsx("p", { className: "eyebrow", children: "Actually Learn" }), _jsx("h1", { children: "Save less. Reflect more. Remember what changed you." }), _jsx("p", { className: "lede", children: "Capture internet media into a user-owned Paradigm graph, but only after you explain why it matters." }), _jsxs("div", { className: "stat-grid", children: [_jsx(Stat, { label: "Saved with reflection", value: String(me.stats.savedCount) }), _jsx(Stat, { label: "Concepts linked", value: String(me.stats.conceptCount) }), _jsx(Stat, { label: "Pending links", value: String(me.stats.pendingSuggestions) })] }), _jsxs("div", { className: "actions", children: [_jsx("button", { className: "primary", onClick: handleConnect, children: me.connected ? "Reconnect Paradigm" : "Connect Paradigm" }), _jsx("button", { className: "secondary", onClick: handleSyncNow, disabled: !me.sync.canSync, children: "Sync now" })] }), _jsxs("div", { className: "status-block", children: [_jsx("p", { className: "status-label", children: me.connected ? "Connected to Paradigm" : "Not connected" }), _jsxs("p", { className: "status-label", children: ["Nodes: ", me.featureFlags.canReadNodes ? "read" : "no read", " /", " ", me.featureFlags.canCreateNodes ? "create" : "no create"] }), _jsxs("p", { className: "status-label", children: ["Relationships: ", me.featureFlags.canReadRelationships ? "read" : "no read", " /", " ", me.featureFlags.canCreateRelationships ? "create" : "no create"] }), _jsxs("p", { className: "status-label", children: ["Last sync: ", me.sync.lastSyncedAt ? new Date(me.sync.lastSyncedAt).toLocaleString() : "Not yet"] })] }), _jsx("p", { className: "status", children: status })] }), _jsxs("main", { className: "workspace", children: [_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Capture" }), _jsxs("form", { className: "capture-form", onSubmit: handleCreateDraft, children: [_jsx("input", { value: url, onChange: (event) => setUrl(event.target.value), placeholder: "Paste a URL" }), _jsx("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Or give it a title" }), _jsx("textarea", { value: notes, onChange: (event) => setNotes(event.target.value), placeholder: "Short excerpt or why you bookmarked it", rows: 4 }), _jsx("button", { className: "primary", type: "submit", children: "Create draft" })] })] }), _jsxs("section", { className: "panel split", children: [_jsxs("div", { children: [_jsx("h2", { children: "Drafts" }), _jsx("div", { className: "draft-list", children: drafts.map((draft) => (_jsxs("button", { className: `draft-card ${selectedDraftId === draft.id ? "active" : ""}`, onClick: () => {
                                                setSelectedDraftId(draft.id);
                                                setReflection(draft.reflection ?? "");
                                            }, children: [_jsx("span", { children: draft.preview.title }), _jsx("small", { children: draft.status.replaceAll("_", " ") })] }, draft.id))) })] }), _jsxs("div", { children: [_jsx("h2", { children: "Reflect" }), selectedDraft ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "draft-title", children: selectedDraft.preview.title }), _jsx("textarea", { value: reflection, onChange: (event) => setReflection(event.target.value), placeholder: "Write at least one thoughtful sentence.", rows: 7 }), _jsx("div", { className: "prompt-list", children: prompts.map((prompt) => (_jsx("button", { className: selectedPrompt === prompt.prompt ? "chip active" : "chip", onClick: () => {
                                                        setSelectedPrompt(prompt.prompt);
                                                        setReflection((current) => current || `${prompt.prompt} `);
                                                    }, children: prompt.prompt }, prompt.id))) }), _jsxs("div", { className: "actions", children: [_jsx("button", { className: "secondary", onClick: handleEvaluate, children: "Evaluate reflection" }), _jsx("button", { className: "primary", onClick: handleCommit, disabled: selectedDraft.status !== "approved_for_save" && !selectedDraft.evaluation?.accepted, children: "Save to graph" })] }), selectedDraft.evaluation ? (_jsxs("p", { className: "feedback", children: ["Score ", selectedDraft.evaluation.score, ": ", selectedDraft.evaluation.feedback] })) : null] })) : (_jsx("p", { children: "Select a draft to write about why it matters." }))] })] }), _jsxs("section", { className: "panel split", children: [_jsxs("div", { children: [_jsx("h2", { children: "Mind map suggestions" }), _jsxs("div", { className: "suggestions", children: [suggestions.length === 0 ? _jsx("p", { children: "No suggestions yet." }) : null, suggestions.map((suggestion) => (_jsxs("div", { className: "suggestion-card", children: [_jsx("strong", { children: suggestion.label }), _jsx("p", { children: suggestion.rationale }), _jsx("small", { children: suggestion.relatedConceptLabels.join(" · ") }), _jsx("button", { className: "secondary", disabled: suggestion.approved, onClick: () => handleApproveSuggestion(suggestion.id), children: suggestion.approved ? "Approved" : "Approve link" })] }, suggestion.id)))] })] }), _jsxs("div", { children: [_jsx("h2", { children: "Graph snapshot" }), _jsxs("div", { className: "graph-box", children: [graph.nodes.map((node) => (_jsxs("div", { className: `graph-node ${node.kind}`, children: [_jsx("span", { children: node.label }), _jsx("small", { children: node.kind })] }, node.id))), graph.nodes.length === 0 ? _jsx("p", { children: "No graph yet. Save and approve a concept." }) : null] })] })] }), _jsxs("section", { className: "panel", children: [_jsxs("div", { className: "section-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "Weekly recap" }), _jsx("p", { children: "Recent items are favored, but older ones resurface as repetition weakens." })] }), _jsx("button", { className: "primary", onClick: handleStartQuiz, children: "Generate quiz" })] }), quiz ? (_jsxs("div", { className: "quiz-list", children: [quiz.questions.map((question) => (_jsxs("div", { className: "quiz-card", children: [_jsx("strong", { children: question.prompt }), _jsx("textarea", { rows: 4, value: quizAnswers[question.id] ?? "", onChange: (event) => setQuizAnswers((current) => ({
                                                    ...current,
                                                    [question.id]: event.target.value,
                                                })) })] }, question.id))), _jsx("button", { className: "secondary", onClick: handleSubmitQuiz, children: "Score recap" })] })) : null, quizResult ? (_jsxs("div", { className: "result-box", children: [_jsxs("strong", { children: ["Score: ", quizResult.score] }), _jsxs("p", { children: ["Reflection streak: ", quizResult.streaks.reflectionDays, " days. Weekly recaps:", " ", quizResult.streaks.weeklyRecaps, "."] })] })) : null] })] })] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { className: "stat-card", children: [_jsx("span", { children: value }), _jsx("small", { children: label })] }));
}
