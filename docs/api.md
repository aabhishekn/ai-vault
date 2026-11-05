# API reference

Base URL `http://localhost:8000`. Interactive docs (Swagger) are at `/docs`. There is no authentication.

## Conventions

- **Errors** are `{"detail": "..."}`. Validation problems are `422`.

  | Code | Meaning |
  | --- | --- |
  | `400` `413` `415` | Upload is empty, too large (over 10 MiB, or too much text to summarize), or not a PDF/PNG/JPG |
  | `404` | Unknown document or conversation (some "not generated yet" reads too) |
  | `409` | Not in the right state: document not searchable or still processing, or a conversation changed meanwhile |
  | `429` | Rate limit; see `Retry-After` |
  | `502` | The AI provider's answer was invalid or incomplete |
  | `503` | A dependency is unavailable (database, Redis, provider). The message is always generic |

- **IDs** are UUIDs. **Lists** take `limit` (1 to 100) and `offset`, and return `items`, `total`, `limit`, `offset`, newest first.
- **Searchable** means the document is `embedded` or `ready`. **Statuses:** `queued`, `processing`, `extracted`, `embedded`, `ready`, `failed`.
- Every response carries an `X-Request-ID` header.
- **Rate limits** apply to endpoints that call the AI provider and to uploads; see [operations.md](operations.md#rate-limits).
- Endpoints marked **AI** send document text to the provider and can incur charges. Saved content is read for free.

## Documents

A document has `id`, `filename`, `title`, `title_source` (`ai` or `user`), `category`, `content_type`, `size_bytes`, `status`, `error_message`, `group_id`, `version_number`, `is_latest` and `created_at`. File paths are never exposed.

| Endpoint | Purpose |
| --- | --- |
| `POST /documents` | Upload one file as multipart field `file`. Returns `201` with the `queued` document and starts background processing |
| `GET /documents` | List documents. Only the latest version of each, unless `include_old_versions=true`. `q` searches (below) |
| `GET /documents/{id}` | Metadata and status. Never the file itself |
| `PATCH /documents/{id}` | Rename: `{"title": "Q3 Plan"}`. `null` or blank clears it, so the file name shows again |
| `DELETE /documents/{id}` | Permanently delete (`204`). See below |
| `POST /documents/{id}/reprocess` | Queue processing again (`202`). See below |

**Upload.** Accepts `.pdf`, `.png`, `.jpg`, `.jpeg` whose first bytes match the type, up to 10 MiB. The file is stored under `storage/documents/` with a generated name. If Redis does not confirm the job, the API returns `503` with `detail.message` and `detail.document_id`; the document is saved, so reprocess it instead of uploading again.

```bash
curl -F "file=@/path/to/document.pdf" http://localhost:8000/documents
```

**Search.** `GET /documents?q=lease agreement` keeps documents whose title, file name or category contain **every** word (any order, partial words, case-insensitive; at most 100 characters and 8 words). `%` and `_` match literally. `total` reflects the search. It is a plain database query with no AI cost.

**Titles.** The AI writes a title when it picks the category. A title a person sets always wins, applies to every version, and is inherited by new versions. Titles are at most 120 characters.

**Reprocess** works for `failed` and `extracted` documents, a `queued` document whose job was never confirmed, and a `processing` document whose worker died (older than 10 minutes). It returns `409` for a document that is `embedded` or genuinely still processing. Uses the `upload` rate limit.

**Delete** removes the document's chunks, vectors, single-document conversations, processing attempts and stored file. A multi-document conversation that included it is deleted too. By default only that version goes (the previous one becomes current); `?all_versions=true` removes every version. A document being processed right now returns `409`.

### Versions

| Endpoint | Purpose |
| --- | --- |
| `POST /documents/{id}/versions` | Upload the next version (multipart `file`, same rules and rate limit as upload). The id of any version works |
| `GET /documents/{id}/versions` | `group_id` and every version, newest first: `id`, `version_number`, `filename`, `title`, `size_bytes`, `status`, `is_latest`, `created_at` |

Each version is a full document of its own, so older chats and citations keep pointing at the exact file. A file identical to the latest version is rejected with `409`.

## Content generated from a document

Summaries, insights and classification need extracted text (`extracted`, `embedded` or `ready`), otherwise `409`. **POST** generates once and saves; repeating returns the saved result without calling the provider. **GET** only reads, and returns `404` until the content exists. The worker generates summary, insights, category and title automatically after embedding, so these calls are mostly for older or failed documents.

| Endpoint | Returns |
| --- | --- |
| `POST` / `GET /documents/{id}/summary` | `document_id`, `summary` (one paragraph). **AI** on POST. Input over 60,000 characters returns `413` |
| `POST /documents/{id}/summary/custom` | A summary in a chosen style: `length` (`short`, `medium`, `long`), `tone` (`neutral`, `formal`, `casual`, `executive`), `focus` (free text, 200 characters). All optional. Returns `summary`, `options`, `cached`. Not saved on the document; cached for 7 days. **AI** |
| `POST` / `GET /documents/{id}/insights` | `insights`: 3 to 5 takeaways, each with `text`, `page_number` and a real `evidence` quote. **AI** on POST |
| `POST` / `GET /documents/{id}/classification` | `category` (one to three words, free-form, at most 40 characters) and `title`. Falls back to the first 4,000 characters when there is no summary. **AI** on POST |
| `POST /documents/{id}/suggested-questions` | 3 to 4 starter questions (`questions`, `cached`) built from the saved summary and insights; `409` until one exists. Cached for 7 days. **AI** |

## Search and questions

`POST /documents/{id}/search` and `POST /documents/{id}/ask` take:

```json
{"question": "Which libraries are recommended?", "top_k": 8}
```

`question` is 1 to 2,000 characters. `top_k` defaults to 8 (1 to 20). The document must be searchable (`409` otherwise).

- **`/search`** returns the closest chunks: `chunk_id`, `chunk_index`, `page_number`, `text`, `cosine_distance` (lower is closer; not a confidence score). It returns `top_k` chunks even for an unrelated question. It embeds the question, a paid call.
- **`/ask`** retrieves and answers without saving anything. Use conversations to keep context. The response has `answer`, `insufficient_evidence`, `citations`, `model` and token counts. **AI**

**Citations.** The answer text contains labels like `[1]`. Each citation has `source_number` (the label), `document_id`, `filename`, `title`, `chunk_id`, `page_number` and the stored `text`, all looked up by the server. When the sources do not support an answer, `insufficient_evidence` is true, `answer` is a fixed message and `citations` is empty. An answer whose labels do not match the retrieved sources is retried once and then returns `502`.

## Conversations

A conversation holds saved turns. One covers a single document or a chosen set of 2 to 10.

| Endpoint | Purpose |
| --- | --- |
| `POST /documents/{id}/conversations` | New empty conversation for a searchable document (`201`) |
| `GET /documents/{id}/conversations` | Its conversations (`id`, `document_id`, `created_at`, `turn_count`). `has_turns=true` skips unanswered ones |
| `POST /multi-conversations` | `{"document_ids": [...]}`: 2 to 10 distinct, searchable documents (`404` or `409` otherwise). `document_id` is `null`; the response lists `document_ids` |
| `GET /multi-conversations` | Multi-document conversations, with the same options |
| `GET /conversations/{id}` | The turns in order, with `limit` and `offset`. Each citation's current `filename` and `title` are filled in, so a rename shows in old answers |
| `POST /conversations/{id}/messages` | Ask a question; returns the saved turn (`201`). **AI** |
| `POST /conversations/{id}/messages/stream` | The same, as server-sent events. **AI** |

**Messages.** The body is the search request plus an optional `replace_turn`. A turn stores the question, the full response with citation snapshots, the model and token usage. Follow-ups use the latest three turns as context (each clipped), and retrieval uses the question together with the previous turn. History is context only, never evidence.

**Several documents.** One search covers all chosen documents. A question about *each*, *every*, *both*, *compare*, *in common* or *differ* takes the best passages of every document instead, so each one is represented. Answers have `document_id: null`, and every citation names its document.

**Editing.** Send the new text with `"replace_turn": N` to replace turn `N` and drop every turn after it. The answer uses only turns before `N` as context, and nothing is deleted unless the new answer is saved. `N` beyond the current turn count returns `409`.

**Conflicts.** Two simultaneous messages cannot both append to the same history: the second gets `409`. Fetch the history and retry.

**Streaming events**

| Event | Data | Meaning |
| --- | --- | --- |
| `delta` | `{"text": "..."}` | The next piece of the answer. A preview only |
| `turn` | the saved turn, as from `/messages` | The final event: validated answer and citations. Show this instead of the streamed text |
| `error` | `{"detail": "...", "status": 502}` | Failed after streaming began; nothing was saved |

Problems found before streaming starts (unknown conversation, document not searchable, retrieval failure) return a normal HTTP error.

## Comparison

`POST /comparisons`: `{"document_ids": [...], "focus": "payment terms"}`. 2 to 5 searchable documents (`409` otherwise, `404` for an unknown id); `focus` is optional, up to 200 characters. Two versions of one file can be compared too. **AI**

The response has `documents`, `focus`, `overview`, `similarities` and `differences`. Each difference has a `topic` and one `position` per document (`"Not addressed"` when it is silent). `cached: true` means the result came from Redis (7 days; document order does not matter).

## Statistics and metrics

None of these calls the AI provider.

| Endpoint | Returns |
| --- | --- |
| `GET /stats/documents` | `total_documents`, `by_status` (zeros included), `total_storage_bytes` (recorded upload sizes, not disk usage), `documents_with_summary`, `total_extracted_pages`, `total_chunks`, `chunks_with_embeddings`. Includes every version |
| `GET /metrics/processing` | `total_attempts`, `processing`, `succeeded`, `failed`, `success_rate` (`null` until one finishes), average, per-outcome and maximum durations in ms, `observed_embedding_input_tokens` |
| `GET /metrics/ai-usage` | `chat` (a row per answer model), `embeddings`, `estimated_total_cost_usd`, `unpriced_models`, `not_persisted` (usage that is only logged). Estimates from `app/core/pricing.py`, not billing data |
| `GET /metrics/api` | Since the API started: `total_requests`, `server_error_rate`, and per route `requests`, `server_errors`, `average_ms`, `p95_ms`, `max_ms`. In memory, so it resets on restart |

Statistics and metrics are computed from stored rows, so deleting a document removes its attempts, chats and tokens from the totals.

## Health

| Endpoint | Tells you |
| --- | --- |
| `GET /health` | `{"status": "ok"}` |
| `GET /health/db` | The database answers |
| `GET /health/queue` | `status` (`ok` or `no_workers`), `redis`, `workers`, `queued_jobs`. `503` if Redis is unreachable |

## Live updates

`WS /ws/events` pushes document changes so the UI updates without refreshing. Messages are JSON text frames:

| Message | Meaning |
| --- | --- |
| `{"type": "ready"}` | The subscription is active |
| `{"type": "document.status", "document_id": "...", "status": "processing"}` | The document moved to a new status |
| `{"type": "document.content", "document_id": "..."}` | Summary, insights, category and title are ready to fetch |
| `{"type": "document.updated", "document_id": "..."}` | A person changed the document (for example renamed it) |
| `{"type": "document.deleted", "document_id": "..."}` | A document was deleted |

Events are not stored or replayed, so treat each as a hint to refetch and refetch everything after a reconnect. If Redis is down the socket closes with code `1013`. In development the frontend connects through the Vite proxy at `/api/ws/events`.
