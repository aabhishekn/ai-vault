# Backend architecture

## Follow one request

`app.main` builds FastAPI, installs the shared service-error handler, and registers the API router. A route validates path/query/body input and calls a service. Services return typed response schemas and raise explicit application errors. The HTTP boundary translates those errors to the existing JSON `detail` format.

SQLAlchemy sessions are scoped to the transaction that needs them. Services use `app.db.queries` for shared document lookup; database queries remain near their owning workflow. No generic repository hierarchy or dependency-injection framework is required for the current application size.

The same services can be called from a future CLI or test without creating an HTTP request. API routes do not import SQLAlchemy, Redis, OpenAI, task internals, or ORM models. Architecture tests enforce these import boundaries.

## Shared infrastructure

`core.config` owns repository paths, environment loading, common model dimensions/status sets, and configuration access. Environment variables override `.env`; restart processes after changing that file. Credentials are never embedded in connection strings committed to Git.

`ai.client.create_client()` owns API-key validation, timeout and retry configuration. Each AI helper keeps its own prompt, output schema and validation. Embedding model/dimension constants are shared by the model column and provider helper. Zero/non-finite vectors and mismatched models are rejected before storage or cosine search.

`services.document_content` owns the shared read-cache/generate/save lifecycle for summaries and insights. Feature services supply the generation callback. Network work happens after the read session closes. A conditional update preserves an earlier saved result during concurrent generation.

## Processing transactions

The RQ entry point is `app.tasks.documents.extract_document`. Its helpers make transaction boundaries visible:

1. Atomically claim a queued/failed document and create its processing attempt. Duplicate jobs return without creating an attempt.
2. Extract the PDF and build chunks outside database transactions.
3. Replace pages/chunks in one transaction. With embeddings disabled, finish the attempt there.
4. Generate embedding batches without a database session; retain observed usage in the processing context.
5. Save every vector, final status and successful attempt together. On an ordinary exception, record document/attempt failure together.

A `ProcessingContext` carries attempt identity, monotonic start time and observed usage. Separate helpers own claiming, path validation, text persistence, batching, vector persistence, and failure recording. This keeps the entry point readable while retaining atomicity guarantees.

## Conversation transactions

Read the latest bounded history, then close the session before retrieval and generation. Save the paired question/answer turn with an optimistic conversation-count update. A conflicting request gets 409 rather than appending an answer based on stale history. Stored citations include snapshots so history remains readable independently of provider state.

## How to extend

Add an HTTP contract under `schemas/` and a route under `api/routes/`. Put workflow logic in `services/`, provider interaction in `ai/`, and pure parsing/text transformations in `processing/`. Add a migration only when persistent schema changes. Preserve old migration bodies; a refactor should produce no Alembic drift. Keep network calls outside transactions and add behavior-focused tests for new failure or concurrency cases.

## Current limits

PostgreSQL commits and Redis enqueueing are not atomic: if the queue is down at upload the document stays `queued`, and `POST /documents/{id}/reprocess` (or the worker's startup recovery for abandoned jobs) re-queues it. A force-killed worker leaves its attempt running until it is older than twice the job timeout, after which it is closed as failed and the document is queued again. Request idempotency and durable accounting for summary, insight and stateless answer usage remain future work (that usage is logged as `ai_call` events).

Word-sized chunks are not token limits. Summary/insight input has a documented size cap. Citation/source-ID validation ensures references exist, not that every generated claim follows from its evidence. The complete API reference describes these operational limits.
