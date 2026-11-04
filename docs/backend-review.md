# Backend review and cleanup

## Scope and result

Reviewed the existing upload, extraction/chunking, queue/worker, embedding, search, answer, conversation, summary, insight, statistics and metrics code, together with tests, migrations, configuration and documentation. Refactored the backend into an explicit `app` package. Existing API methods, request bodies and response schemas are preserved; startup and CLI commands now use package module paths.

## Findings addressed

| Finding | Change |
| --- | --- |
| HTTP declarations, SQL and provider orchestration were mixed in flat files | Thin `api/routes` delegate to framework-independent `services`; schemas are grouped by documents, chat and analytics |
| Provider setup and environment/path loading were repeated | Shared `core.config` and `ai.client` own paths, settings, model dimensions, key validation, timeout and retry configuration |
| Summary and insight cache/save workflows were duplicated | Shared `services.document_content` handles readiness, cached reads and conditional saving outside provider transactions |
| Worker stages and transaction boundaries were difficult to scan | Named helpers handle claim, extraction persistence, embedding batches, vector persistence and failure recording; typed context carries attempt identity and usage |
| Service errors depended on FastAPI | Explicit application errors are rendered at one HTTP boundary; services import no web framework |
| Broad runtime-error catches could mask programming failures | Availability handling catches configuration errors and provider errors explicitly |
| Upload cleanup could replace the original database error with a filesystem exception | Failed cleanup logs a safe warning while preserving the original failure response |
| Invalid vectors could reach cosine search or mix model spaces | Embedding responses reject zero/non-finite vectors, invalid dimensions/indices and mismatched models; worker batches also verify count/model |
| Formatting and import conventions were unenforced | Ruff lint, import sorting, formatting configuration and development dependencies added |
| Existing tests did not cover the moved HTTP boundary | Added route/schema/error regression tests and import-boundary architecture checks |
| Long chronological README obscured setup and architecture | Concise setup guide plus dedicated architecture and API/operations documentation |

## Verification

- Original baseline: 70 tests passed before refactoring.
- Refactored suite: 80 tests passed, including database integration tests.
- Ruff lint and formatting checks passed; dependency consistency check passed.
- Alembic reports no schema drift. Applied migration bodies remain unchanged.
- Full migration chain and all 80 tests passed against a new isolated PostgreSQL database; that database was removed afterward.
- Compared all 13 existing API paths, methods, request bodies, response schemas and component schemas against the pre-refactor running API.
- A real HTTP upload went through Redis and the new package worker, producing four pages, six chunks and a successful attempt. Embeddings were disabled for that verification job; no paid AI requests were made.
- Existing saved summary, five insights and two-turn conversation remained readable through HTTP.
- API and worker restarted with the new commands. GitHub Actions is configured to repeat lint, formatting, migrations and tests on pushes and pull requests.

## Important operational details

From `backend/`, use `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` and `python -m app.worker`. Enqueue/recovery utilities live under `app.cli`. Drain pending jobs from an older checkout before switching worker import paths; completed history and stored documents require no data migration.

## Deliberate remaining limits

The refactor preserves the documented local-development behavior. PostgreSQL and Redis do not share an atomic enqueue transaction; killed-worker recovery and request idempotency remain future work. Observed token counts are not complete billing records. Word-based chunks and input character caps are not token budgeting. Source/citation checks validate references, not full semantic entailment. These operational limits and recovery steps are documented in [API and operations](api.md).

There is no need for a repository class per table or an additional dependency-injection framework at this size. New features should follow the existing route → service → database/provider boundaries, with behavior-focused tests and migrations only when persistent structure changes.
