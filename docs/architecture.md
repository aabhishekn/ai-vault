# Architecture

How the backend is put together and why. For endpoints see [api.md](api.md); for running it see [operations.md](operations.md).

**Contents:** [Code boundaries](#code-boundaries) · [Processing pipeline](#processing-pipeline) · [Retrieval and answers](#retrieval-and-answers) · [Generated content](#generated-content) · [Caching](#caching) · [Data model](#data-model) · [Live updates](#live-updates) · [Known limits](#known-limits)

<hr>

## Code boundaries

A request flows one way: **route → service → database or provider**.

| Layer         | Does                                                         | Must not                                                                              |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `api/routes/` | Validates input, calls one service, returns a typed response | Touch SQLAlchemy, Redis, OpenAI or ORM models                                         |
| `services/`   | The workflow: queries, transactions, calls to `ai/`          | Import FastAPI. They raise explicit errors that one handler turns into HTTP responses |
| `ai/`         | One module per AI feature: prompt, output schema, validation | Touch the database                                                                    |
| `processing/` | Pure text work: PDF and image reading, chunking              | Call the network                                                                      |
| `tasks/`      | The RQ job and its transaction boundaries                    |                                                                                       |

Architecture tests (`tests/test_architecture.py`) enforce the import rules. Two more rules: network calls never happen inside a database transaction, and applied migrations are never edited.

To add a feature: a schema in `schemas/`, a route in `api/routes/`, the workflow in `services/`, the provider call in `ai/`, a migration only if stored data changes, and tests for the failure and concurrency cases.

<hr>

## Processing pipeline

The worker job (`tasks/documents.py`) runs in short stages so a failure never loses earlier work:

1. **Claim** the document with one conditional update and record a processing attempt. A duplicate job finds it already claimed and skips.
2. **Read** the file outside any transaction: PDF text per page, or vision transcription for scans and pictures.
3. **Save** pages and chunks in one transaction. With embeddings off, the job ends here at `extracted`.
4. **Embed** the chunks in batches of 64, again outside a transaction.
5. **Save** all vectors, the `embedded` status and the successful attempt together.
6. **Generate** summary, insights, category and title, each independently and best effort. This runs after the attempt is recorded, so it can never fail the document.

On an ordinary error, the document and its attempt are marked failed together, with the extracted text kept. Chunks never cross a page, so every citation has an exact page. Chunking uses LlamaIndex's `SentenceSplitter` page by page, with sizes counted in words.

<hr>

## Retrieval and answers

LlamaIndex handles the document-specific steps; our code keeps the guarantees.

| Step      | Implementation                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedding | `VaultEmbedding` is a LlamaIndex embed model that calls our OpenAI helper, keeping exact token counts and retry policy. Query vectors are cached in Redis.                                           |
| Storage   | The `document_chunks` table, with a `vector(1536)` column.                                                                                                                                           |
| Retrieval | `ChunkVectorStore` is a read-only LlamaIndex vector store over that table; `VectorStoreIndex` retrieves with a `document_id` filter. A search that is not filtered to specific documents is refused. |
| Answers   | The OpenAI SDK with structured output. LlamaIndex's OpenAI package needs an older SDK than this project uses, so its LLM classes are not used.                                                       |

**One question, step by step**

1. Retrieve the 8 closest chunks (`top_k`, up to 20). There is no distance cutoff; the model abstains through an `insufficient_evidence` flag.
2. For a follow-up, search twice (the bare question, and the question plus a slice of the previous turn) and fuse the two rankings, so a change of subject is not dragged back to the old topic. No separate "rewrite the question" model call.
3. Across several documents, one query covers all of them (at most 12 passages, repeated text dropped). A question about _each_ or _every_ document, or one that compares them, instead takes the 2 best passages of every document so a few cannot fill every slot.
4. The model sees the sources grouped by document, the question, and the last three turns as untrusted context (history resolves "those", never counts as evidence).
5. The model returns `answer`, `source_numbers` and `insufficient_evidence`. The `[n]` labels written in the answer decide which sources are cited. Each must be a real source; otherwise the question is asked once more, and then rejected (HTTP 502) rather than shown.
6. The server attaches page, quote, document and chunk id from the stored chunk, never from the model.
7. If the structured output is cut off, the retry uses `ANSWER_MODEL`, since the same model would stop in the same place.

Small server-side repairs follow: control characters are stripped (PostgreSQL cannot store NUL), and names with accents that the model mangled are restored from the sources.

**Streaming.** The streaming endpoint decodes the `answer` text from the model's JSON as it arrives and sends it as `delta` events. The turn is saved only after the full answer passes validation, so a dropped connection leaves the conversation unchanged.

**Editing a question** replaces that turn and every turn after it, in one transaction and only once the new answer is saved. Keeping a single linear history matches the context window and the stored turn numbers; branches would need a tree of turns.

**Concurrency.** The database session is closed before retrieval and generation. A turn is saved with an optimistic check on the conversation's turn count, so two simultaneous messages cannot both append to the same history: one gets 409.

<hr>

## Generated content

| Feature             | Model sees                                                                       | Server guarantees                                                                                |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Summary             | The extracted text (at most 60,000 characters, otherwise 413)                    | Complete, non-blank, at most 4,000 characters                                                    |
| Insights            | Numbered excerpts of 240 characters                                              | The model picks an excerpt id; the server copies the real quote and page and rejects unknown ids |
| Category and title  | The saved summary and insights, not the full text                                | Category of 1 to 3 words, at most 40 characters; a person's own title is never replaced          |
| Custom summary      | The text plus length, tone and focus (focus is passed as data, not instructions) | Not saved on the document                                                                        |
| Comparison          | Per document: summary, insights and its 4 best passages for the focus            | Document numbers map back to ids; impossible drafts are rejected                                 |
| Suggested questions | Summary and insights                                                             | 3 to 4 questions                                                                                 |

Every prompt declares document text, questions and history untrusted data. The pattern is the same everywhere: **the model produces judgments, the server produces facts.**

<hr>

## Caching

| What                                               | Where                                         | Lifetime                             |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| Summary, insights, category, title                 | Document row                                  | Saved once, reused                   |
| Query embeddings                                   | Redis, keyed by model and normalised question | `EMBEDDING_CACHE_TTL_SECONDS` (24 h) |
| Custom summaries, suggested questions, comparisons | Redis, keyed by model and inputs              | 7 days                               |

Answers are not cached: they depend on the conversation and cost more to get wrong. A Redis outage only costs a regeneration; a cache can never fail a request.

<hr>

## Data model

| Table                                 | Holds                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`                           | Metadata, status, extracted pages, summary, insights, category, title, and version fields (`group_id`, `version_number`, `is_latest`, `content_hash`) |
| `document_chunks`                     | Chunk text, page, index, embedding and its model                                                                                                      |
| `processing_attempts`                 | One row per processing run: outcome, duration, embedding tokens                                                                                       |
| `conversations`, `conversation_turns` | Saved chats; each turn stores the full answer with citation snapshots, model and token usage                                                          |
| `conversation_documents`              | Which documents a multi-document conversation covers                                                                                                  |

Every column is listed in the [README](../README.md#database).

**Versions.** Every version is a full document of its own, linked by a shared `group_id`, so an old conversation always points at the exact file it was asked about. Uploading identical bytes to the latest version is rejected by hash.

**Deletes.** Chunks, attempts and single-document conversations cascade. A multi-document conversation that included the document is deleted too, because its answers quote the deleted file. The stored file is removed after the commit.

<hr>

## Live updates

The worker is a separate process, so it cannot reach browsers directly. When a status changes, the worker (or an API request) publishes an event on the Redis channel `vault:events`; each WebSocket connection subscribes in the API process and forwards what it receives. Events are not stored or replayed, so the frontend treats each as a hint to refetch and refetches everything after a reconnect. Publishing is best effort and never fails the work it reports.

<hr>

## Known limits

- Citation checks prove a source exists, not that every claim follows from it.
- Word-based chunks are not token budgets.
- PostgreSQL and Redis are not atomic: see recovery in [operations.md](operations.md#processing-and-recovery).
- API latency statistics live in memory and reset on restart. Token usage for summaries, insights and one-shot `/ask` is logged, not stored.
- No request idempotency: a retried request can be charged twice.
