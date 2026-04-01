# Actually Learn

Web-first reflective media app built on the Paradigm third-party app model. Users can save media into a user-owned graph only after writing a meaningful reflection, then revisit items through concept links and a weekly recall quiz.

## Workspace layout

- `apps/api`: Express API for Paradigm auth, media capture, reflection evaluation, concept approval, graph state, quiz generation, and streaks
- `apps/web`: React + Vite client for the core v1 flows
- `packages/shared`: shared schema URIs, contracts, and types
- `docs/PARADIGM_SCHEMAS.md`: JSON Schema drafts to create in the Paradigm UI
- `third_party_starter-main`: cloned Paradigm starter kit docs used as the implementation reference

## Quick start

1. Install dependencies with `npm install`
2. Copy `apps/api/env.example` to `apps/api/.env`
3. Copy `apps/web/env.example` to `apps/web/.env`
4. If you want live Paradigm integration, fill in the `PARADIGM_*` values from the Developer Dashboard and make sure `APP_CALLBACK_URL` matches your registered callback exactly
5. Run the API with `npm run dev -w @actually-learn/api`
6. Run the web app with `npm run dev -w @actually-learn/web`

If the Paradigm environment variables are missing, the API falls back to a demo mode so you can still exercise the capture, reflection, concept, and quiz loops locally.

## Paradigm setup

Create these schemas in the Paradigm UI before registering the app:

- `actually-learn:media_item`
- `actually-learn:reflection_entry`
- `actually-learn:concept_node`
- `actually-learn:quiz_session`
- `actually-learn:quiz_response`

Then register the app in the Paradigm Developer Dashboard with:

- hosted URL: your web app origin
- callback URL: `http://localhost:4000/api/auth/paradigm/callback` for local development
- permissions: `nodes.read`, `nodes.create`, `relationships.read`, `relationships.create`

## API surface

- `GET /api/auth/paradigm/start`
- `GET /api/auth/paradigm/callback`
- `GET /api/me`
- `POST /api/media/preview`
- `GET /api/media/drafts`
- `POST /api/reflections/evaluate`
- `POST /api/reflections/prompts`
- `POST /api/media/commit`
- `GET /api/concepts/suggestions`
- `POST /api/concepts/approve`
- `GET /api/graph`
- `GET /api/quiz/weekly`
- `POST /api/quiz/:id/answer`
- `GET /api/quiz/:id/result`

## Notes

- App-private backend state now persists to a local SQLite database at `apps/api/data/actually-learn.sqlite` by default. Override with `APP_DB_PATH` if you want a different location.
- Paradigm writes occur only on commit and concept approval, and only when the required environment variables are configured.
- Reflection evaluation is implemented as a lightweight local rubric so the hard gate works without an external LLM dependency. This can be swapped for a model-backed evaluator later without changing the API contracts.
- The SQLite integration uses Node's built-in `node:sqlite` module, which currently emits an experimental warning on test runs under Node 24.

## PR security gates

- `.github/workflows/dependency-review.yml` runs GitHub's official dependency review check on every pull request to `main`.
- `.github/workflows/osv-scanner-pr.yml` runs OSV-Scanner on every pull request and merge queue evaluation for `main`.
- `.github/dependency-review-config.yml` also explicitly blocks a small set of package/version combinations tied to recent supply-chain incidents, including `axios@1.14.1`, `axios@0.30.4`, `plain-crypto-js`, and the malicious `telnyx` PyPI releases `4.87.1` and `4.87.2`.
- To turn these into true merge gates, add both checks as required status checks in your GitHub branch protection rules for `main`.
- GitHub's dependency review action requires a public repository or GitHub Advanced Security on private repositories. OSV-Scanner does not have that limitation.
