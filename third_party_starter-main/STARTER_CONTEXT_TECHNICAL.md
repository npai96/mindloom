# Paradigm SDK — Technical Reference for Third-Party Apps

## Apps vs Plugins

Paradigm supports two kinds of third-party integrations. They share the same authentication and permission model but serve different purposes:

- **App** — A persistent integration that connects to a user's Identity Graph over time. Apps have their own UI, maintain ongoing access via an Exposure Profile, and read/write user data across sessions. Think: a journaling app that syncs entries, a CRM that pulls relationship data, or an AI assistant that proposes new nodes.

- **Plugin** — A stateless, single‑execution operation that runs once and returns a result. Plugins are executed on demand — either manually by the user, triggered by an automation, or invoked by another app. Authorization is ephemeral (scoped to that execution). Plugins can declare a data contract: what data they need as input (`node_requirements`), what they produce (`output_declaration`), and what the user can configure (`input_parameters`). Currently, plugins primarily operate on nodes — they take nodes as input and produce nodes as output.

You register both on the Paradigm Developer Dashboard. Everything in this document — authentication, permissions, endpoints, schemas, nodes, tags, relationships, proposals — applies to **apps**. Plugins share the same authentication and permission model, but they operate differently at runtime (see the Plugins section for details).

**Registration fields:**
- **Apps** must provide a `redirect_uri` (callback URL) and should provide a hosted/website URL.
- **Plugins** must provide a `plugin_endpoint_url` (the execution endpoint).

**Quick reality check:**
- **Apps** make direct API calls back to Paradigm using `X-API-Key` + `X-User-ID`.
- **Plugins** receive a POST payload of resolved input nodes (not just IDs), and respond with actions (create/edit/delete/propose). Paradigm applies those actions.

---
## Authentication

Third-party apps use **API key authentication**. Every API request requires two headers:

```
X-API-Key: ofs_tp_{api_key_id}.{secret}
X-User-ID: <user-uuid>
```

- `X-API-Key` identifies your app. Format: `ofs_tp_` prefix + 16-char public ID + `.` + 43-char secret.
- `X-User-ID` identifies which user's data you're accessing. Required on every data request.

`GET /third-party/me` also accepts `X-User-ID` — if provided, the response includes that user's permissions and exposure profile for your app. If omitted, you get only your app's metadata (no permissions).

Your API key is issued once during registration. It cannot be retrieved again — store it securely.

---
## Base URL

```
https://api.ofself.ai/api/v1
```

---
## Authorization Flow (apps only)

> **Plugins skip this flow.** Plugin authorization is ephemeral — it happens automatically at execution time when a user (or automation) triggers the plugin. You do not need to implement the callback flow below for plugins.

Your app cannot access user data until the user explicitly authorizes it.

### Step 1: Redirect user to Paradigm

```
https://app.ofself.ai/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_CALLBACK_URL
```

> **Important: the authorize URL is NOT an API endpoint.** The `/authorize` page is served by the Paradigm frontend, not the API backend. Do not use your API base URL (e.g., `https://api.ofself.ai/api/v1/authorize`) — use the frontend origin directly (e.g., `https://app.ofself.ai/authorize`).

### Step 2: User authorizes

Paradigm shows the user a consent screen. They select a **Privacy Realm** (which sets the ceiling on what data is accessible) and configure an **Exposure Profile** (the specific grant to your app). If the user has already authorized your app and it hasn't expired, they are redirected back immediately.

### Step 3: Handle the callback

On approval:

```
https://yourapp.com/callback?code=success&client_id=YOUR_CLIENT_ID&user_id=USER_UUID
```

On denial:

```
https://yourapp.com/callback?error=access_denied&client_id=YOUR_CLIENT_ID
```

**You must extract and store `user_id`** — you need it for every API call for that user. Only one active authorization exists per (app, user) pair.

### Step 4: Make API calls

```bash
curl https://api.ofself.ai/api/v1/nodes \
  -H "X-API-Key: $PARADIGM_API_KEY" \
  -H "X-User-ID: $USER_ID"
```

---
## Deployment Modes (Incubator vs Public)

New apps default to **Incubator** mode. Incubator apps are private and can only be authorized by users on the app’s allowlist. Public apps are visible to all users.

**Recommended workflow:**
- Build and test against production using your own account (no local SDK required).
- In the Developer Dashboard, add your user ID to the app’s allowlist.
- When you’re ready for wider access, switch to **Public**.

---
## Permission Model

Understanding the permission model is critical. It determines what your app can and cannot do.

### How permissions work

When a user authorizes your app, they grant it an **Exposure Profile** — the specific set of permissions and data your app can access. The Exposure Profile specifies:

- `permissions` — which actions your app can take (e.g., read nodes, create tags)
- `selected_tag_ids`, `selected_schema_ids`, `selected_node_ids` — which data is in scope
- `scope_filters` — per-verb restrictions (e.g., "can only create nodes with these tags")
- `slots` — the user's bound values for your app's declared `input_parameters`, resolved and ready to use (see Input Parameters)

Behind the scenes, the user controls a **Privacy Realm** that acts as a ceiling over your Exposure Profile. You don't interact with the realm directly, but you should know it exists: if a user tightens their realm, your permissions shrink immediately — even mid-session — without any reauthorization step. This is by design.

**Your app can see its full Exposure Profile** by calling `GET /third-party/me` with `X-User-ID`. The response includes the exposure profile under the `exposure_profile` key — containing `selected_tag_ids`, `selected_schema_ids`, `selected_node_ids`, `scope_filters`, `enabled_verbs`, and lifecycle fields (`expires_at`, `is_active`). Bound input parameter values are returned separately as `slots` (see Input Parameters).

**Always check your `permissions` at startup** via `GET /third-party/me` and handle the case where you have fewer permissions than expected.

### Permission verbs

| Resource | Verbs |
|---|---|
| **nodes** | `read`, `create`, `edit_content`, `delete`, `propose` |
| **tags** | `discover`, `read`, `propose`, `edit`, `create` |
| **relationships** | `read`, `create`, `edit`, `delete` |
| **plugins** | `execute` |

### Checking your permissions

Call `GET /third-party/me` with `X-User-ID` to see what you can do:

```json
{
  "permissions": {
    "nodes": ["read", "create"],
    "tags": ["discover"],
    "relationships": ["read"]
  }
}
```

- `permissions` — the actions your Exposure Profile allows, organized by resource. Check these before attempting operations.
- `rate_limits` — your current rate limits

### Data filtering

All read endpoints automatically filter results to only data within your Exposure Profile scope. You don't need to filter yourself — the API does it for you. If a node is outside your scope, the API returns 404 (not 403), so you cannot distinguish "doesn't exist" from "not in your scope."

---
## Core Endpoints

### App Info

```
GET /third-party/me
```

Returns your app's metadata, the user's permissions, realm capabilities, resolved slots, and rate limits. Call this first to understand what you can access.

**Optional header:** `X-Sub-Entity: <key>` — returns the sub-entity's exposure profile instead of the default (see Sub-Entities section).

**Response includes:** `permissions`, `exposure_profile`, `realm_permissions`, `slots`, `rate_limits`

**Example response (trimmed):**

```json
{
  "permissions": { "nodes": ["read"], "tags": ["discover"] },
  "exposure_profile": { "selected_tag_ids": [], "selected_schema_ids": [] },
  "slots": []
}
```

### Slots

```
GET /slots
```

Lightweight endpoint that returns only your resolved slot bindings for the current app+user. Useful when you need to poll slot values without the full `/third-party/me` payload.

**Required headers:** `X-API-Key`, `X-User-ID`

**Response:**

```json
{
  "slots": [
    {
      "key": "source_tag",
      "label": "Source Tag",
      "type": "tag",
      "bound_value": "tag-uuid",
      "bound_name": "journal-entries"
    }
  ]
}
```

### User Lookup

```
GET /third-party/users/lookup     Look up a public user by ID
GET /third-party/users/search     Search public users by username
```

**Required header:** `X-API-Key` (no `X-User-ID` needed)

**`GET /third-party/users/lookup` query parameters:**
- `user_id` (required) — UUID of the user to look up

**`GET /third-party/users/search` query parameters:**
- `q` (required) — search string (matches username, case-insensitive)
- `limit` (optional, default 20, max 50)

**Response (both endpoints):**

```json
{
  "user_id": "uuid",
  "username": "janedoe",
  "first_name": "Jane",
  "last_name": "Doe",
  "is_public": true
}
```

Only users with `is_public: true` are returned. Non-public users return 404.

### Nodes

Nodes are the core data units in a user's Identity Graph.

```
GET    /nodes                      List nodes (filtered by exposure profile)
GET    /nodes/{id}                 Get a specific node
POST   /nodes                      Create a node
PUT    /nodes/{id}                 Update a node
DELETE /nodes/{id}                 Delete a node
GET    /nodes/{id}/relationships   Get a node's connections
GET    /nodes/count                Count nodes (filtered)
```

**Query parameters for `GET /nodes`:**
- `limit` (default 20, max 100) — results per page
- `offset` (default 0) — pagination offset
- `search` — full-text search in title + `value_json` (JSON content)
- `tag_ids` — comma-separated tag IDs
- `tag_id` — filter by single tag ID
- `schema_id` — filter by schema
- `metadata_key` / `metadata_value` — filter by metadata
- `sort` — sort field (default: `created_at`)
- `order` — `asc` or `desc` (default: `desc`)
- `include_tags` — `true` to include associated tags (default: `false`)
- `fields` — comma-separated list of fields to return (e.g., `id,title,value_json,created_at,tags`). Omit `value_json` for faster list responses.
- `include_value` — legacy. Use `fields=value_json` instead.

**Query parameters for `GET /nodes/count`:**
- `schema_ids` — comma-separated schema UUIDs (use `__freeform__` for nodes with no schema)
- `tag_ids` — comma-separated tag UUIDs

**Create node body (`POST /nodes`):**

```json
{
  "title": "Meeting notes from Friday",
  "value_json": { "content": "Discussed Q2 roadmap..." },
  "content_type": "text",
  "tags": ["tag-uuid-1", "tag-uuid-2"],
  "schema_id": "schema-uuid",
  "schema_uri": "my-app:expense",
  "language": "en",
  "source_type": "manual",
  "content_timestamp": "2025-01-15T10:30:00Z"
}
```

**Required fields:** `title`

**Optional fields:** `value_json` (defaults to `{}`), `content_type`, `tags`, `schema_id`, `schema_uri`, `language`, `source_type`, `content_timestamp` (ISO 8601)

**Tags behavior:** The `tags` array accepts both UUIDs (existing tags) and plain strings (tag names). If a tag name doesn't exist, it is **auto-created** for the user. For third-party apps, tag creation is subject to Exposure Profile scope — tags outside your scope are silently dropped.

**Response includes:** `id`, `title`, `value_json`, `content_type`, `source_type`, `language`, `word_count`, `schema_id`, `content_timestamp`, `created_at`, `updated_at`

### Node Tag Management

```
POST   /nodes/{id}/tags            Add a tag to a node
DELETE /nodes/{id}/tags/{tag_id}   Remove a tag from a node
```

**Add tag body (`POST /nodes/{id}/tags`):**

```json
{
  "tag_id": "tag-uuid"
}
```

You can also pass `"tag_name": "my-tag"` instead of `tag_id` — the tag will be auto-created if it doesn't exist.

**Response:** Updated node object.

### Batch Node Creation

```
POST   /nodes/batch                Create up to 100 nodes in one request
```

The batch processes all valid nodes — invalid ones are reported in `errors` without failing the batch.
Each node is validated against its schema (same validation as `POST /nodes`).

**Request body:**

```json
{
  "nodes": [
    {
      "title": "Morning standup",
      "tags": ["work"],
      "schema_id": "schema-uuid"
    }
  ],
  "on_duplicate": "skip"
}
```

- `nodes` (required) — array of 1–100 node objects (same schema as `POST /nodes`)
- `on_duplicate` — `"skip"` (default) or `"overwrite"`. Duplicates are detected by matching on `(title, value_json)` within the user's data.

**Response** (201 if all created, 200 if mixed, 400 if all failed):

```json
{
  "created": [{"index": 0, "id": "uuid", "title": "..."}],
  "skipped": [],
  "updated": [],
  "errors": [],
  "summary": {"total": 1, "created": 1, "skipped": 0, "updated": 0, "errors": 0}
}
```

### Bulk Node Deletion

```
POST   /nodes/bulk-delete          Delete multiple nodes in one request
```

**Request body:**

```json
{
  "node_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

**Response:**

```json
{
  "deleted_count": 3,
  "deleted_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

### Tags

```
GET    /tags               List available tags
GET    /tags/{id}          Get a specific tag
GET    /tags/{id}/nodes    Get nodes with this tag
POST   /tags               Create a tag (requires tags.create permission)
PUT    /tags/{id}          Update a tag
DELETE /tags/{id}          Delete a tag
POST   /tags/bulk-delete   Delete multiple tags at once
```

**Query parameters for `GET /tags`:**
- `category` — filter by category
- `parent_tag_id` — filter by parent (tags are hierarchical)
- `search` — search tag names
- `access` — `owned`, `shared`, or `all` (default: all)

**Create tag body:**

```json
{
  "name": "quarterly-review",
  "category": "business",
  "color": "#3B82F6",
  "description": "Quarterly review notes",
  "parent_tag_id": "uuid"
}
```

Tag names are unique per user. Tags support hierarchies via `parent_tag_id`. Color must be hex format (`#RRGGBB`).

**Bulk delete body (`POST /tags/bulk-delete`):**

```json
{
  "tag_ids": ["uuid-1", "uuid-2"]
}
```

### Files (Upload & Download)

Files are stored as nodes using the `paradigm:RawFile` system schema.

```
POST   /nodes/upload               Upload a file (multipart/form-data)
GET    /nodes/{id}/download        Download a file node
```

**Upload (`POST /nodes/upload`):**

Multipart form data:
- `file` — the binary file (required, max 100MB)
- `title` — optional, defaults to filename
- `description` — optional
- `tags` — optional JSON array of tag IDs

The upload creates a node with the `paradigm:RawFile` schema. The response is a standard node object.

**Download (`GET /nodes/{id}/download`):**

Returns the binary file content. The node must have been created via `/nodes/upload` (i.e., it uses the `paradigm:RawFile` schema). Access is governed by your Exposure Profile.

To **list files**, use `GET /nodes` filtered by the `paradigm:RawFile` schema ID.

### Relationships

```
GET    /relationships              List relationships
GET    /relationships/{id}         Get a relationship
POST   /relationships              Create relationship
PUT    /relationships/{id}         Update relationship
DELETE /relationships/{id}         Delete relationship
```

**Query parameters for `GET /relationships`:**
- `from_node_id` — filter by source node
- `to_node_id` — filter by target node
- `relationship_type` — filter by type
- `include_nodes` — `true` to include full node details on each relationship (default: `false`)
- `access` — `owned`, `shared`, or `all` (default: `all`)
- `limit` (default 500, max 1000) — results per page
- `offset` (default 0) — pagination offset

**Create relationship body:**

```json
{
  "from_node_id": "node-uuid-1",
  "to_node_id": "node-uuid-2",
  "relationship_type": "references",
  "context": "These documents discuss the same project",
  "bidirectional": false
}
```

**Fields:**
- `from_node_id` (required) — source node UUID
- `to_node_id` (required) — target node UUID
- `relationship_type` (required) — freeform string, max 50 chars. Common values: `references`, `related_to`, `contains`, `mentions` — but you can use any type that fits your domain.
- `context` (optional) — text describing why these nodes are related
- `bidirectional` (optional) — boolean, default false

**Validation:**
- Cannot create self-references
- Both nodes must belong to the user and be within your Exposure Profile scope
- Duplicate (from, to, type) combination is rejected (409)

### Schemas

Schemas define node structure using JSON Schema. If your app or plugin produces structured output, you **must** have a schema before you can register the app/plugin and create nodes with validated metadata.

For third‑party developers, schema creation is **UI‑only** in the Paradigm Schema Manager. Create the schema **before** app/plugin registration so you can reference it during setup.

> **Important workflow:** Before creating a schema, search existing schemas first in the UI. Reusing an existing schema means your data is interoperable with other apps. If nothing fits, create a new schema in the UI.

**Read‑only schema endpoints:**

```
GET    /schemas                        List schemas
GET    /schemas/{id}                   Get a schema
GET    /schemas/uri/{schema_uri}       Get schema by URI (optional ?version=N)
GET    /schemas/categories             List schema categories
POST   /schemas/{id}/validate          Validate metadata against schema
```

**Creating a node with a schema:**

```json
{
  "title": "Coffee purchase",
  "value_json": {
    "content": "Morning coffee",
    "amount": 5.50,
    "currency": "USD",
    "category": "food"
  },
  "schema_id": "schema-uuid",
}
```

The API validates `value_json` against the schema before saving. Schemas support inheritance (`extends` field) and versioning. You can reference schemas by URI using `schema_uri` instead of `schema_id` in `POST /nodes`.

---
## Proposals

Proposals let your app suggest changes without directly modifying user data. The user reviews and approves or rejects in the Paradigm UI. **Your app cannot self-approve proposals.**

```
POST   /proposals                  Create a proposal
GET    /proposals                  List your proposals
GET    /proposals/{id}             Get proposal details
PATCH  /proposals/{id}             Update a proposal
DELETE /proposals/{id}             Delete a proposal
POST   /proposals/{id}/apply       Apply an approved proposal (executes the changes)
POST   /proposals/subscribe        Subscribe to proposal events
GET    /proposals/events           Poll for proposal events
```

**Create proposal body:**

```json
{
  "title": "Extract entities from uploaded document",
  "description": "Found 23 entities in the document...",
  "type": "CREATE_NODE",
  "status": "PENDING",
  "raw_data": {},
  "canonical_data": {},
  "tags": ["tag-name-1", "tag-name-2"],
  "entity_tags": {"Entity Name": ["tag1"]},
  "reasoning_metadata": {},
  "actions": []
}
```

**Required fields:** `title`, `type`

**Proposal types:** `CREATE_NODE`, `UPDATE_NODE`, `DELETE_NODE`

**Status lifecycle:**
1. `PENDING` — initial state (your app creates it here)
2. `READY_FOR_APPROVAL` — your app signals it's ready for user review
3. `APPROVED` — user approved (only the user can set this)
4. `REJECTED` — user rejected
5. `APPLIED` — changes executed via `POST /proposals/{id}/apply`
6. `FAILED` — execution failed

**Important rules:**
- Third-party apps **cannot** create proposals with status `APPROVED` or `APPLIED`
- Third-party apps **cannot** modify proposals after they've been `APPROVED` (to prevent race conditions after approval)
- Each app only sees its own proposals (cross-app isolation)

**Update proposal (`PATCH /proposals/{id}`):**
Updatable fields: `canonical_data`, `tags`, `entity_tags`, `reasoning_metadata`, `actions`, `status` (only to `PENDING` or `READY_FOR_APPROVAL`)

**Subscribe to events (`POST /proposals/subscribe`):**

```json
{
  "event_types": ["created", "approved", "rejected", "applied"],
  "webhook_url": "https://myapp.com/proposals/events"
}
```

**Poll for events (`GET /proposals/events`):**
- `since` — ISO 8601 timestamp
- `limit` — max results (default 50, max 100)

---
## Sync API (apps only)

> **Not applicable to plugins.** Plugins are stateless and don't maintain sync cursors. Use this only from persistent app integrations.

Cursor-based delta sync for efficiently pulling changes since your last sync.

```
GET /sync              Delta sync (returns changes since cursor)
GET /sync/status       Sync health and pending change count
```

**Query parameters for `GET /sync`:**
- `cursor` — opaque cursor from previous sync response. Omit for initial full sync.
- `scope` — `all` (default), `tag:<tag_uuid>`, or `schema:<schema_uuid>`
- `limit` — max changes per page (default 100, max 1000)
- `ids_only` — `true` to return only node IDs (lighter payload)
- `include_tags` — `true` to include tags in node data

**Response:**

```json
{
  "changes": [
    {
      "action": "create",
      "timestamp": "2025-01-15T10:30:00Z",
      "version": 5,
      "changed_fields": ["title", "value_json"],
      "node": { "id": "...", "title": "...", "..." : "..." }
    }
  ],
  "cursor": "opaque_cursor_string",
  "has_more": false,
  "stats": { "created": 2, "updated": 1, "deleted": 0, "total": 3 }
}
```

**Actions:** `create`, `update`, `delete`, `tag_added`, `tag_removed`

**Usage pattern:**
1. First sync: call `GET /sync` with no cursor -> get all changes + cursor
2. Subsequent syncs: pass the returned `cursor` -> get only new changes
3. If `has_more` is true, keep paginating with the new cursor

**`GET /sync/status` response:**

```json
{
  "total_versions": 150,
  "latest_change": "2025-01-15T10:30:00Z",
  "pending_changes": 12,
  "scopes": {
    "all": { "last_sync_at": "...", "last_version_seen": 138, "pending_changes": 12 }
  }
}
```

---
## Plugins

### For apps: discovering and executing plugins

Apps (and users) can discover and execute plugins via these endpoints:

```
GET    /plugins                     List available plugins
GET    /plugins/{id}                Get plugin details
POST   /plugins/{id}/execute        Execute a plugin
```

Requires the `plugins.execute` permission verb.

**Execute plugin (`POST /plugins/{id}/execute`):**

```json
{
  "scope": {
    "tag_ids": ["uuid-1"],
    "node_ids": ["uuid-2"],
    "exclude_node_ids": ["uuid-3"]
  },
  "remove_source": false,
  "input_parameters": { "verbose": true }
}
```

- `scope` — defines which nodes to pass to the plugin. Filter by tags, specific node IDs, or exclude nodes.
- `remove_source` — if `true`, source nodes are deleted after processing (default: plugin's configured default).
- `input_parameters` — values for the plugin's declared `input_parameters` (user-configurable options).

The execution creates an ephemeral Exposure Profile scoped to the input data, calls the plugin, and processes the output.

**Plugin execution request (what your endpoint receives):**

```json
{
  "nodes": [{ "id": "node-uuid", "title": "Note", "value_json": { "content": "..." } }],
  "input_parameters": { "verbose": true }
}
```

### For plugin developers: how execution works

If you are building a plugin, your plugin does **not** call the Paradigm API directly during execution. Instead:

1. **You register your plugin** with a `plugin_endpoint_url` — this is the URL Paradigm calls when your plugin is executed.
2. **You declare a data contract** during registration:
   - `node_requirements` — what input data your plugin needs (e.g., nodes matching a specific schema, or any nodes)
   - `output_declaration` — what your plugin produces (e.g., creates nodes with a given schema, edits existing nodes)
   - `input_parameters` — user-configurable options (e.g., `verbose: boolean`, `target_tag: tag`)
3. **At execution time**, Paradigm resolves the input nodes matching your requirements and POSTs them to your endpoint.
4. **Your plugin returns** structured output — an array of actions (create, edit, delete, propose) with node data.
5. **Paradigm processes the output** — creating nodes, editing content, attaching tags, or generating proposals.

**Example (high‑level):**
- **Input:** `nodes` array with full node objects matching `node_requirements`.
- **Output:** actions like `create_node` or `propose_update` with `value_json`, `tags`, and `schema_id`.
- **Permissions:** plugin execution uses the permissions you declare; your code does not call the API during execution.

**Example (response body):**

```json
{
  "actions": [
    {
      "type": "create_node",
      "title": "Summary",
      "value_json": { "content": "..." },
      "tags": ["summary"],
      "schema_id": "schema-uuid"
    }
  ]
}
```

Plugins can use the same API key authentication to call read endpoints (e.g., `GET /schemas`, `GET /tags`) outside of execution if needed, but all write operations during execution are handled by the execution engine based on your declared `output_declaration`.

---
## Sub-Entities — Agent Isolation (apps only)

> **Not applicable to plugins.** Plugins run in a single scoped execution context. Use sub-entities only from persistent app integrations with multiple agents.

If your app has multiple agents or components that should have **independent permission scopes**, use sub-entities. Each sub-entity gets its own Exposure Profile, and the user can assign it to a different Privacy Realm.

```
POST   /third-party/sub-entities             Declare a sub-entity
GET    /third-party/sub-entities             List your sub-entities
DELETE /third-party/sub-entities/{key}       Revoke a sub-entity
```

**Declare a sub-entity:**

```json
{
  "sub_entity_key": "research-agent",
  "display_name": "Research Agent",
  "description": "Handles research tasks"
}
```

- `sub_entity_key` must be alphanumeric with hyphens/underscores, max 100 chars
- Initially inherits the app's default Privacy Realm
- User can reassign the sub-entity to a different realm via the Paradigm UI

**Using a sub-entity's permissions:**
Pass `X-Sub-Entity: research-agent` header on `GET /third-party/me` to get that sub-entity's exposure profile and realm permissions.

---
## Input Parameters

Your app or plugin can declare `input_parameters` during registration — named parameters that users bind to values (tags, schemas, text) during authorization. These are resolved at runtime and returned in the `slots` field of `GET /third-party/me` (or via the dedicated `GET /slots` endpoint):

```json
{
  "slots": [
    {
      "key": "source_tag",
      "label": "Source Tag",
      "type": "tag",
      "bound_value": "tag-uuid",
      "bound_name": "journal-entries"
    }
  ]
}
```

**Parameter types:** `tag`, `schema`, `text`, `select`, `node_type`, `boolean`

Use these to dynamically scope your app's behavior based on what the user configured.

---

## Node History

Track the version history of specific nodes.

```
GET /nodes/{node_id}/history                    Get version history for a node
GET /nodes/{node_id}/history/{version}          Get a specific version
GET /nodes/{node_id}/history/at-time?t=<iso>    Get node state at a point in time
```

History is scoped to nodes within your Exposure Profile.

---
## Audit Logs

View audit trail of actions taken via your app.

```
GET /audit-logs          List audit logs (app-scoped: you only see your own actions)
GET /audit-logs/{id}     Get a specific audit entry
```

---
## Error Handling

| Code | Meaning | What to do |
|------|---------|------------|
| 200 | Success | — |
| 201 | Created | Resource created |
| 400 | Bad Request / `VALIDATION_ERROR` / `MISSING_USER_ID` | Check your request body/params. Make sure `X-User-ID` is included. |
| 401 | `UNAUTHORIZED` / `INVALID_API_KEY` | API key is wrong or malformed. Check your key. |
| 403 | `NO_AUTHORIZATION` / `PERMISSION_DENIED` | User hasn't authorized your app, or their exposure profile doesn't allow this action. Don't retry — the user must grant permission. |
| 404 | `NOT_FOUND` | Resource doesn't exist **or** isn't in the user's exposure profile. You cannot tell which. |
| 409 | Conflict | Duplicate resource (e.g., authorization already exists, relationship already exists, sub-entity already declared) |
| 413 | Payload too large | File exceeds 100MB limit |
| 429 | Rate limited | You've exceeded your tier's rate limit. Back off and retry. |
| 500 | Server Error | Retry with backoff |

**Error response format:**

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "hint": "Optional hint for developers"
  }
}
```

---
## Rate Limiting

Apps are rate-limited per-app, per-user. Treat 429s as a signal to back off and retry with exponential backoff.

Your exact limits are returned by `GET /third-party/me` in the `rate_limits` field. Individual Exposure Profile grants can further cap limits per user.

---
## Pagination

Most list endpoints support pagination with two styles:

**Offset-based (recommended):**
- `limit` — results per page (default varies, max 100)
- `offset` — skip this many results

**Page-based:**
- `page` — page number (1-indexed)
- `per_page` — results per page

Responses include: `total`, `has_next`, `has_prev` (and sometimes both `limit/offset` and `page/per_page`).

**Note:** The `/relationships` endpoint has higher pagination limits (default 500, max 1000) than other endpoints.

---
## Best Practices

- Treat 404 as “not found or not in scope.” Do not imply existence.
- Never show UUIDs to end users. Map IDs to human‑readable labels in UI and errors.
- Call `GET /third-party/me` on startup and after authorization. Gate features by returned permissions.
- Handle permission errors (403/404) gracefully.
- Use proposals when suggesting changes to user data (especially if you don't have direct write permission).
- Use schemas when creating structured data.
- Use `GET /sync` for efficient incremental data fetching instead of polling `GET /nodes`.
- Use server‑side API calls only. Never expose `X-API-Key` in frontend code.
- Store your API key in environment variables, never in client-side code.
- Log minimally. Avoid logging raw node content or full payloads.
- Use `value_json` as the canonical content field and keep it structured and small.
- For large blobs, use file nodes (`POST /nodes/upload`) instead of stuffing data into `value_json`.
- Prefer `schema_uri` when you want the latest schema version without hard‑coding IDs.
- When creating tags by name, remember tag creation is permission‑scoped and can be silently dropped.
- If you run multiple agents or components, use sub‑entities (`X-Sub-Entity`) to isolate permissions.
- Don’t assume authorization is permanent — users can revoke at any time.
- Don’t retry on 403 — it means the user hasn’t shared that data.
- Don’t try to create pre‑approved proposals — only users can approve.
- Don’t modify proposals after they’ve been approved — create a new one instead.
- Don’t assume your permissions are static — the user can tighten their Privacy Realm at any time.
- Don’t request more permissions than you need.
- Don’t store user data longer than necessary.
- Don’t create a second authorization for the same user — only one active per (app, user) pair.
