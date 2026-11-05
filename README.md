# AI Vault

A local document vault with AI built in. Upload PDFs and images, then search, read, compare and chat with your documents; every answer cites the page it came from.

How AI tools were used to build it: [AI_USAGE.md](AI_USAGE.md).

## What it does

- **Upload** PDF, PNG or JPG (up to 10 MB). Processing runs in the background: text extraction, chunking, embeddings. Scans and photos are read page by page by a vision model.
- **Chat** with one document or several (2 to 10). Answers stream in, cite the page and quoted passage, and keep follow-up context. Conversations are saved; the last question can be edited.
- **Understand** each document automatically: summary, key insights with page evidence, category and title. Customize a summary by length, tone and focus.
- **Compare** 2 to 5 documents (similarities and differences by topic). Suggested starter questions per document.
- **Organize**: search by title, file name or category, document versions, rename, delete.
- **Observe**: live status updates over WebSocket, document statistics, processing metrics, AI token usage and estimated cost, API latency, health checks, JSON logs, rate limits.

Built with Python 3.12, FastAPI, SQLAlchemy, PostgreSQL + pgvector, Redis + RQ, LlamaIndex and OpenAI. The frontend is React, Vite and Tailwind CSS in plain JavaScript.

## Quick start

You need Docker, Python 3.12 and Node.js 24 (what CI uses).

**1. Configure.** Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` and `OPENAI_API_KEY`. Keep `.env` out of Git.

**2. Start the database and Redis.**

```bash
docker compose up -d --wait
```

**3. Start the API** (from `backend/`).

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**4. Start the worker** in a second terminal (same folder, same virtual environment). Without it, uploads stay `queued`.

```bash
python -m app.worker
```

**5. Start the frontend** in a third terminal.

```bash
cd frontend
npm ci
npm run dev
```

Open the app at http://localhost:5173. The API docs (Swagger) are at http://localhost:8000/docs.

Without an `OPENAI_API_KEY`, extraction still works but documents stop at **Text extracted**: chat, search, summaries and insights need the embeddings a key enables. These features send document text to OpenAI and can incur charges. Other settings are in [docs/operations.md](docs/operations.md).

## How it works

```mermaid
flowchart TD
    UI[React frontend] -->|HTTP / JSON, WebSocket| API[FastAPI server]
    API -->|save uploads| FS[(File storage)]
    API -->|enqueue job| Q[(Redis queue)]
    Q --> W[RQ worker]
    FS --> W
    W -->|pages, chunks, vectors, summary, insights| DB[(PostgreSQL + pgvector)]
    API <-->|metadata, chats, retrieval, metrics| DB
    W -->|embeddings, summaries| AI[OpenAI]
    API -->|question embeddings, answers| AI
```

**Upload.** The API validates and stores the file, records it as `queued` and returns at once. A worker extracts text with page numbers, splits it into chunks of up to 200 words that never cross a page, embeds them, then generates the summary, insights, category and title. Status moves `queued`, `processing`, `embedded` (shown as **Search ready**), or `failed` with a readable reason.

**Chat.** The question is embedded and the closest chunks are retrieved with pgvector. The model answers only from them and marks each fact with a label like `[1]`. The server then attaches the real page number and quoted text for each label and rejects labels that do not exist, so a citation cannot be invented. If the sources do not support an answer, the model says so instead of guessing.

The principle throughout: **the model produces judgments, the server produces facts.** More in [docs/architecture.md](docs/architecture.md).

## Documentation

| Doc | What is in it |
| --- | --- |
| [docs/api.md](docs/api.md) | Every endpoint, with request and response behavior |
| [docs/architecture.md](docs/architecture.md) | Code boundaries, the processing pipeline, retrieval and answers, caching |
| [docs/operations.md](docs/operations.md) | Configuration, worker, recovery, rate limits, logging, migrations, tests |
| [frontend/README.md](frontend/README.md) | Frontend structure, behavior and checks |
| [AI_USAGE.md](AI_USAGE.md) | How AI was used to build this, and where it was wrong |

## Project layout

```text
backend/
  app/
    api/routes/     HTTP endpoints (validation only)
    services/       workflows: documents, search, chat, content, metrics
    ai/             OpenAI calls, prompts and output validation
    processing/     PDF/image reading and chunking
    tasks/          background job and its transactions
    db/ core/ schemas/ cli/
  migrations/       Alembic migrations
  tests/
frontend/src/       app/, features/, components/, lib/
docs/
```

## Design decisions

| Decision | Why |
| --- | --- |
| **LlamaIndex** for chunking, embedding and retrieval | Document Q&A is what it is built for. Our own table and OpenAI helper sit underneath, so migrations, cascade deletes and exact token counts keep working. |
| **OpenAI SDK directly** for answers, summaries and insights | Strict structured output, citation retries and streaming are tested against the SDK. LlamaIndex's OpenAI package needs an older SDK than this project pins. |
| **PostgreSQL + pgvector** | One store for metadata, chats and vectors, written in the same transactions. |
| **RQ + Redis**, not Celery | Smaller, and enough for one queue with retries and status. |
| **Page-bounded chunks** (up to 200 words, 40 overlap) | Every citation has a precise page. |
| **Server-built citations** | The model writes `[n]` labels only; page and quote come from stored chunks. |
| **Follow-ups without a rewrite call** | Retrieval searches the bare question and the question with the previous turn, then fuses the two rankings. No extra model call. |
| **Chat uses `gpt-4.1`**, other generation `gpt-4.1-mini` | A wrong detail does the most harm in an answer. Change with `CHAT_MODEL`. |
| **Failures are isolated** | A failed embedding keeps the extracted text; a failed summary keeps the document searchable. |
| **Rate limits per client IP**, failing open | Protects the endpoints that spend money; a Redis outage does not take the API down. |

## Assumptions and limits

- **Single tenant, no login.** Anyone who can reach the API sees and can delete every document. Deletion is permanent.
- PDF, PNG and JPG only, up to 10 MB. No DOCX. Scanned PDFs are limited to 10 pages (`OCR_MAX_PAGES`), and handwriting or complex tables can be misread. Summaries and insights read at most 60,000 characters.
- Written for English documents and a local setup (Docker services, local disk, OpenAI as the provider).
- Token usage for summaries, insights and one-shot `/ask` is logged but not stored, so `GET /metrics/ai-usage` undercounts spend.
- Answer quality was checked by tests and manual trials, not an automated evaluation set.
- Hosted use would need HTTPS, a trusted-proxy policy for client IPs, secrets management and backups.

## Scaling to thousands of documents

Not load-tested; this is how the design should behave and what would change.

- **Ingestion** scales by running more workers: claiming a document is atomic and abandoned jobs are recovered. Uploads return immediately, and embeddings are batched.
- **Search** is filtered to the chosen documents (at most 10), so only their vectors are compared and no vector index is needed yet. Searching the whole library at once would need an HNSW index.
- **Reads** are paginated and skip large text columns. At very large scale, cache the statistics and move page text out of the document row.
- **Cost** is bounded by batching, saved summaries and insights, cached query embeddings, output caps, rate limits and a daily quota.
- **Storage** is behind one save function; S3-compatible storage would replace local disk for several API hosts.

## Tests

```bash
# backend, from backend/ with the virtual environment active
python -m ruff check . && python -m ruff format --check .
python -m pytest
RUN_INTEGRATION_TESTS=1 python -m pytest   # also runs the database tests
python -m alembic check

# frontend, from frontend/
npm run lint && npm run format:check && npm test && npm run build
```

Tests never call the paid provider. GitHub Actions runs all of this on every push, with PostgreSQL/pgvector and Redis for the backend.
