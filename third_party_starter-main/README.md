# Paradigm SDK — Third-Party Starter Kit

This GitHub repo is a **template**. Clone it to start a new integration.

## What's in here

| File | Purpose |
|------|---------|
| `STARTER_CONTEXT_VISION.md` | What Paradigm is, why it exists, and why building on it matters |
| `STARTER_CONTEXT_TECHNICAL.md` | Full API reference — auth, endpoints, payloads, permissions, error handling |
| `env.example` | Environment variables your app needs |

## Apps vs Plugins — which are you building?

**App** — A persistent integration that reads and writes to a user's Identity Graph (their structured personal data in Paradigm) over time. Apps have their own UI, maintain ongoing access via Exposure Profiles (user‑configured permission grants), and call the Paradigm API directly. Examples: a journaling app, a CRM, an AI assistant.

**Plugin** — A stateless operation that runs once per invocation. Paradigm calls your endpoint with input data; you return structured output. No direct API calls needed during execution. Examples: an entity extractor, a summarizer, a data transformer.

Both use the same API key format and permission model. The technical doc covers both, with clear labels on what's app-specific, plugin-specific, or shared.

This should make your scope clear and help you map directly to the endpoints in `STARTER_CONTEXT_TECHNICAL.md`.

## Getting started

### 1. Decide what you are building

Read the "Apps vs Plugins" section above and decide which model fits your use case.

## How to Think About Your Integration
Start with the data flow. Write these answers down before you code:
1. What data are you operating on? Where does the data come from (Paradigm nodes, your own db, another app, another plugin)?
    a. What schema, tags, or fields, if any, do you want to restrict by?
2. What data do you produce?
3. What permissions are required to read and write that data?
4. Are you calling another app or plugin from within your app/plugin?

### 2. (If needed) Create your schema **in the UI**

If your app or plugin requires a custom schema (custom node types, tags, or fields), create it **first** in the Paradigm UI (Schema Manager). You will need the schema ID or URI during registration.

> Note: For now, schema creation is **UI-only** for third‑party developers.

#### Schema format (clarity)
Paradigm schemas use **JSON Schema (draft 2020-12)**. At minimum:
- The top-level should be a JSON object with `type: "object"`.
- Define fields under `properties`.
- Use `required` to mark mandatory fields.
- Use `title` to provide a human‑readable label for a field.

Example (journal entry schema):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "properties": {
    "body": {
      "title": "Entry",
      "type": "string"
    },
    "date": {
      "format": "date",
      "title": "Date",
      "type": "string"
    },
    "location": {
      "title": "Location",
      "type": "string"
    },
    "mood": {
      "enum": [
        "great",
        "good",
        "neutral",
        "bad",
        "terrible"
      ],
      "title": "Mood",
      "type": "string"
    },
    "tags": {
      "items": {
        "type": "string"
      },
      "title": "Tags",
      "type": "array"
    }
  },
  "required": [
    "body"
  ],
  "type": "object"
}
```

### 3. Register on the Paradigm Developer Dashboard (UI)

Go to [app.ofself.ai](https://app.ofself.ai) and create your app or plugin on the Register page. You'll need to provide:

- **App name** — a human-readable name shown to users on the consent screen
- **Description** — what your app does (shown during authorization)
- **Callback URL (apps only)** — the exact URL Paradigm will redirect to after authorization (e.g., `http://localhost:5002/callback`).
- **Website / Hosted URL (apps)** — where your app is hosted (used for discovery and trust).
- **Plugin Endpoint URL (plugins)** — the URL Paradigm will call when your plugin executes.

If you created a custom schema in Step 2, keep the schema ID or URI handy — you will reference it during registration and building.

**Callback URL must match exactly.** The `redirect_uri` you save in your backend must exactly match what you register here. Mismatches will prevent redirect.

On successful registration you'll be shown your **API key** and **client ID**. These are displayed **only once** — copy them immediately and store them securely. If you lose the API key, you'll need to re-register.

- **API key** — format: `ofs_tp_<id>.<secret>`. Used in the `X-API-Key` header on every request.
- **Client ID** — format: `tp_<random>`. Used to initiate the authorization flow (apps) or identify your plugin.

### 4. Set your deployment mode (incubator vs public)

New apps default to **Incubator** (private). In incubator mode, only allow‑listed users can authorize your app.

- **Testing in production is expected.** You do not need to run the SDK locally to start building. Use your own account as a tester.
- In the Developer Dashboard, add your user ID (and any teammates) to the allowlist for your app.
- When you’re ready for wider access, switch the app to **Public**.

### 5. Set up your environment (local)

Copy `env.example` to `.env` and fill in your credentials:

```
PARADIGM_API_KEY=ofs_tp_XXXXX.XXXXX
PARADIGM_BASE_URL=https://api.ofself.ai/api/v1
PARADIGM_APP_URL=https://app.ofself.ai
PARADIGM_CLIENT_ID=tp_XXXXX
APP_CALLBACK_URL=http://localhost:3000/callback
```

#### Auth URL vs API URL

Your app needs **two** Paradigm URLs:

| Variable | Example | Used for |
|----------|---------|----------|
| `PARADIGM_BASE_URL` | `https://api.ofself.ai/api/v1` | Server-side API calls (`/nodes`, `/tags`, `/schemas`, etc.) |
| `PARADIGM_APP_URL` | `https://app.ofself.ai` | Browser redirect to `/authorize` (the consent page) |


### 6. Start building (LLM)

If you use an LLM, paste the **two context files** and use a prompt like this:

> Here are two context files about the Paradigm SDK:
> - `STARTER_CONTEXT_VISION.md`
> - `STARTER_CONTEXT_TECHNICAL.md`
>
> I am building a **[app|plugin]** called **[name]**. It should:
> - [describe the user workflow]

> - [describe exactly what data it reads/writes or produces]
> - [list any schemas or tags it must use]
>
> Generate a complete working integration with:
> - A minimal project structure
> - The auth flow (if app)
> - API calls using the Paradigm SDK endpoints
> - Error handling for 401/403/404/429

## What you need and when (quick checklist)

1. UI before registration (only if you need a custom schema): Schema ID or schema URI from the Schema Manager.
2. UI during registration: App name, description, callback URL (apps only), website/hosted URL (apps only), plugin endpoint URL (plugins only).
3. UI after registration: `API key` (shown once) and `Client ID` (shown once).
4. LLM session (if you use one for coding the app): The docs in this repo
5. Local setup: `.env` with `PARADIGM_API_KEY`, `PARADIGM_CLIENT_ID`, `APP_CALLBACK_URL`, and base URLs.

## Testing checklist (prod-first)

Use production by default.

1. Register your app in the Developer Dashboard and keep it in **Incubator** mode.
2. Add your own user ID to the allowlist.
3. Complete the auth flow and confirm you receive `user_id`.
4. Call `GET /third-party/me` and confirm your permissions and exposure profile.
5. Perform a minimal “happy path” request for your integration (app or plugin).
6. Confirm you can read back or observe the expected result for that integration.
7. Revoke access in Paradigm and verify your app handles permission errors gracefully (403/404).
