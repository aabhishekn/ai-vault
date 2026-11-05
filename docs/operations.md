# Operations

Everything about running, configuring and checking AI Vault. Commands run from `backend/` with the virtual environment active unless noted. Setup steps are in the [README](../README.md).

## Services

`docker compose up -d --wait` (from the repository root) starts PostgreSQL with pgvector (`127.0.0.1:5433`) and Redis (`127.0.0.1:6379`). Redis keeps an append-only file and never evicts keys, so queued jobs are not dropped silently; after a crash it can lose about the last second of writes.

`docker compose stop` stops them. `docker compose down -v` also **deletes** the database and Redis volumes.

## Configuration

Settings come from the repository-root `.env` (copy `.env.example`). Real environment variables override it. Restart the API and worker after changing anything.

| Setting | Default | Meaning |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | required | Also `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PORT` (defaults `ai_vault`, `ai_vault`, `127.0.0.1`, `5433`) |
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Queue, caches, rate limits, live events |
| `OPENAI_API_KEY` | empty | Needed for embeddings, chat and everything generated |
| `ENABLE_EMBEDDINGS` | on when a key is set | `true` or `false` forces it. Off means documents stop at `extracted` |
| `AUTO_GENERATE_CONTENT` | follows `ENABLE_EMBEDDINGS` | Generate summary, insights, category and title after embedding |
| `ANSWER_MODEL` | `gpt-4.1-mini` | Summaries, insights, classification, comparison, suggestions; also the retry model for chat |
| `CHAT_MODEL` | `gpt-4.1` | Chat answers. Use `gpt-4.1-mini` for about a fifth of the cost |
| `OCR_MODEL`, `OCR_MAX_PAGES` | `ANSWER_MODEL`, `10` | Vision model and page limit for scanned PDFs |
| `AI_RATE_LIMIT_PER_MINUTE`, `AI_DAILY_QUOTA` | `20`, `500` | Per client IP; `0` disables a rule |
| `UPLOAD_RATE_LIMIT_PER_MINUTE` | `10` | Per client IP; `0` disables |
| `RATE_LIMIT_ENABLED` | `true` | `false` turns all limits off |
| `EMBEDDING_CACHE_TTL_SECONDS` | `86400` | Query-embedding cache lifetime; `0` turns it off |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` or `CRITICAL` |

## The worker

A separate process does the processing: `python -m app.worker` (leave it running), or `python -m app.worker --burst` to drain the queue and exit. It uses RQ's `SpawnWorker`, which is safe on macOS. Restart it after changing its code.

`GET /health/queue` shows whether Redis is reachable and how many workers are listening:

```json
{"status": "ok", "redis": "connected", "workers": 1, "queued_jobs": 0}
```

`status` is `no_workers` (HTTP 200) when nothing would pick jobs up, and the web app shows a notice. Redis down returns 503. A worker killed without shutting down stays counted for a few minutes.

## Processing and recovery

A document moves `queued`, `processing`, then `embedded` (or `extracted` when embeddings are off), or `failed` with a readable `error_message`. `ready` is accepted and treated as searchable, but the pipeline stops at `embedded`.

- **Claiming is atomic.** Two jobs for one document cannot run together; the second is skipped.
- **Failures keep earlier work.** A failed embedding keeps the extracted text; a failed summary keeps the document searchable. Automatic generation never fails a document.
- **Retry.** `POST /documents/{id}/reprocess` (or **Process again** in the UI) re-queues a `failed` or `extracted` document. It also re-queues a `queued` document whose job was never confirmed.
- **Dead workers.** A document stuck in `processing` for more than 10 minutes (twice the 5-minute job timeout) is closed as failed and queued again, either when a worker starts or when you reprocess it.
- **Redis down at upload.** The file and record are saved, and the API returns 503 with the `document_id`. The document stays `queued`; reprocess it. PostgreSQL and Redis do not share a transaction, so a crash between the two can also leave a document waiting without a job. Same fix.
- **Manual command.** `python -m app.cli.enqueue_document DOCUMENT_UUID` queues a `queued` or `failed` document.

### Scanned PDFs and images

A PDF with no text layer, or a PNG/JPG, is drawn to JPEG pages (longest side 2000 px) and transcribed by the vision model, three pages at a time. The pages then follow the normal pipeline, so answers cite the scan's page. A picture counts as page 1.

A scanned PDF over `OCR_MAX_PAGES` pages fails with a message saying so; nothing is read partially. Each page is one paid request, logged as an `ocr` call. A page with no legible text becomes an empty page, and a document with no text at all fails.

## Migrations

```bash
python -m alembic upgrade head   # apply
python -m alembic current        # show the version
python -m alembic check          # fail if the models and migrations drift
```

`app/db/models.py` is the desired schema and `migrations/versions/` is its history. After changing models: `python -m alembic revision --autogenerate -m "What changed"`, review the file, then upgrade. Do not edit applied migrations. Downgrades drop data; do not run them on data you want.

## Rate limits

Endpoints that spend provider money are limited per client IP with fixed-window counters in Redis. Rejected requests still count, and an exceeded limit returns HTTP 429 with a `Retry-After` header.

| Scope | Endpoints | Default |
| --- | --- | --- |
| `ai` | ask, messages (and stream), suggested questions, summary, custom summary, insights, classification, comparisons | 20 per minute, 500 per day |
| `upload` | `POST /documents`, new versions, reprocess | 10 per minute |

Reads, health checks, statistics and metrics are not limited. The limiter fails open (and logs `rate_limiter_unavailable`) if Redis is down. Clients are identified by the direct peer address, so behind a reverse proxy everyone would share the proxy's address; trusting `X-Forwarded-For` needs a known proxy and is not enabled.

## Logging

Every process writes JSON lines to stderr. Events:

- `request` and `request_failed`: method, path, status, duration, client. Each response has an `X-Request-ID` header (a safe client-supplied ID is reused) and every log line from that request carries it.
- `ai_call`: operation (`embeddings`, `answer`, `summary`, `insights`, `ocr`, ...), model, tokens, duration. Summary and insight usage can be audited here, since it is not stored in the database.
- `document_processing_started`, `_finished`, `_failed`, `_skipped`, and `auto_generation_failed` from the worker.
- `rate_limit_exceeded`, `rate_limiter_unavailable`, `embedding_cache`, `conversation_failed`.

Logs hold identifiers, sizes, durations, token counts and outcomes, not document text, questions or answers. Failure tracebacks can include provider error text, so keep logs private. Run uvicorn with `--no-access-log` to avoid duplicate request lines.

## Monitoring

| Endpoint | Tells you |
| --- | --- |
| `GET /health`, `/health/db`, `/health/queue` | The API is up, the database answers, a worker is running |
| `GET /stats/documents` | Documents by status, storage, pages, chunks, vectors |
| `GET /metrics/processing` | Processing attempts: success rate and durations |
| `GET /metrics/ai-usage` | Tokens and estimated cost per model (prices in `app/core/pricing.py`) |
| `GET /metrics/api` | Per-route request counts and latency since the API started |

## Tests and CI

```bash
python -m ruff check .
python -m ruff format --check .
python -m pytest
RUN_INTEGRATION_TESTS=1 python -m pytest
python -m alembic check
```

The integration tests need the local PostgreSQL with migrations applied and use their own records or temporary tables. All other tests mock the provider; a guard fails any test that constructs a real client. GitHub Actions runs lint, formatting, a migration replay and the full suite against PostgreSQL/pgvector and Redis, plus the frontend lint, format, test and build.
