# Paradigm Schema Drafts

Create these in the Paradigm Schema Manager before registering the app. The code references the matching `schema_uri` values from `packages/shared/src/index.ts`.

Current URI mapping in the app:

- `mediaItem`: `custom:actually-learn-media-item-2`
- `reflectionEntry`: `custom:actually-learn-reflection-entry`
- `conceptNode`: create this next, then update the app with the generated `custom:...` URI
- `quizSession`: `custom:actually-learn-quiz-session`
- `quizResponse`: `custom:actually-learn-quiz-response`

## `actually-learn:media_item`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": { "title": "URL", "type": "string" },
    "excerpt": { "title": "Excerpt", "type": "string" },
    "domain": { "title": "Domain", "type": "string" },
    "mediaType": { "title": "Media Type", "type": "string" },
    "author": { "title": "Author", "type": "string" },
    "capturedAt": { "title": "Captured At", "type": "string", "format": "date-time" }
  },
  "required": ["domain", "mediaType", "capturedAt"]
}
```

## `actually-learn:reflection_entry`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "reflection": { "title": "Reflection", "type": "string" },
    "score": { "title": "Reflection Score", "type": "number" },
    "feedback": { "title": "Evaluator Feedback", "type": "string" },
    "promptUsed": { "title": "Prompt Used", "type": "string" },
    "savedAt": { "title": "Saved At", "type": "string", "format": "date-time" }
  },
  "required": ["reflection", "score", "savedAt"]
}
```

## `actually-learn:concept_node`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "rationale": { "title": "Rationale", "type": "string" },
    "relatedLabels": {
      "title": "Related Labels",
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["rationale"]
}
```

### Create This In The Paradigm UI

Use this when creating the missing concept schema:

- Name: `Actually Learn Concept Node`
- Description: `A reusable concept or theme inferred from saved media and reflections.`
- Category: `Knowledge`
- Visibility: `Public`
- Extend an existing schema: `None`

Fields:

1. `rationale`
- Type: `Text`
- Help text: `Why this concept is relevant to the saved item or reflection`
- Required: checked

2. `relatedLabels`
- Type: if array/list text is supported, use that
- Otherwise create it as `Text`
- Help text: `Other labels or nearby themes connected to this concept`
- Required: unchecked

If the Paradigm UI does not support arrays cleanly, using `Text` for `relatedLabels` is fine for now. The app currently writes an array, but we can easily adjust the payload after you share the real generated schema URI and final field shapes.

## `actually-learn:quiz_session`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "score": { "title": "Score", "type": "number" },
    "questionCount": { "title": "Question Count", "type": "number" },
    "completedAt": { "title": "Completed At", "type": "string", "format": "date-time" }
  },
  "required": ["score", "questionCount", "completedAt"]
}
```

## `actually-learn:quiz_response`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "questionType": { "title": "Question Type", "type": "string" },
    "answer": { "title": "Answer", "type": "string" },
    "correct": { "title": "Correct", "type": "boolean" },
    "feedback": { "title": "Feedback", "type": "string" }
  },
  "required": ["questionType", "answer", "correct"]
}
```
