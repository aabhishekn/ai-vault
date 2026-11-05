# AI usage

How AI tools helped build AI Vault, step by step, and where I had to correct them. The AI features inside the product are described in [docs/architecture.md](docs/architecture.md).

## Tools

| Tool | Used for |
| --- | --- |
| **Codex** (ChatGPT desktop app) | The first build: backend core and the first screens |
| **Claude Code** | Reviews and fixes, then the later work: cost tracking, logging, rate limiting, job recovery, bonus features, polish, cleanup, docs |
| **OpenAI API** | Inside the product: embeddings, answers, summaries, insights |

I did not use Cursor or Copilot.

## How I built it

1. **Design first.** Before writing code I read the case study and fixed the high-level design: upload, then a Redis queue and a worker that extracts text, splits it into chunks and creates embeddings, stored in PostgreSQL with pgvector, with retrieval and cited answers on top. Stack: FastAPI, PostgreSQL + pgvector, Redis + RQ, Alembic, OpenAI. Order: the required backend first, then the UI, then the bonus features. One rule for every AI feature: the model produces judgments, the server produces facts, so page numbers and quotes come from stored text, never from the model.
2. **Backend core (day 1).** Codex built it one capability per commit: Docker services, upload, worker, PDF extraction, chunking, embeddings, search, cited answers, conversations, summaries, insights, statistics, metrics. For each step it explained the idea first, then built it and showed it working.
3. **Review and restructure (day 2).** Before any frontend, I had the whole backend reviewed and organised into layers (routes, services, ai, processing, tasks), with tests that enforce the import rules.
4. **Frontend.** React screens for the same flow: documents, upload, summary, insights, chat, metrics. Later moved from TypeScript to plain JavaScript and restyled.
5. **Gap check.** I went through the case study point by point and found what was missing: automatic summaries and insights, cost tracking, rate limiting, logging and recovery of stuck jobs. Added all of them.
6. **Bonus features.** Streaming answers, LlamaIndex retrieval, custom summaries, category and title, versions, multi-document chat, comparison, suggested questions, Redis caching and live updates over WebSocket. One at a time, each with tests, a live check and a commit.
7. **Polish (day 3).** Chat as the main screen, scanned PDFs and images read by a vision model, scannable answers, editing the last question, phone layout.
8. **Accuracy and cleanup.** I tested the chat with real questions and fixed what failed (see below). Then I removed dead code, grouped the frontend into folders and rewrote the docs shorter.

## How I kept control

- **I made the decisions:** the stack, LlamaIndex for retrieval, what to build first.
- **Small steps.** About 100 commits over three days, each one a single feature: build, test, commit.
- **Everything is tested.** About 380 backend and 535 frontend tests, lint, a migration check and CI. Tests never call the paid API.
- **Regular reviews.** I paused feature work several times to review the whole codebase before adding more.

## Where AI was wrong

- **It rushed.** Codex started installing things before explaining. I stopped it and we agreed to explain first.
- **First code needed review.** A whole-backend review found a worker crash that left documents stuck in `processing`, full text loaded on every lookup, and embeddings off by default, so a fresh clone could never search. All fixed with tests.
- **Missing features.** The first version made summaries only on request, and had no cost tracking, rate limiting or detailed logging. The gap check (step 5) caught these.
- **Weak answers.** Real questions showed that a change of subject was searched with the old topic, "each document" skipped some documents, and a stray character from a PDF broke saving. The model also accepted a false premise ("the Node.js server" in a FastAPI project) and defended it when challenged. Each is fixed and tested.
- **Docs that disagreed with the code.** The AI wrote limitations the code did not have. Re-reading them against the code fixed that.

## Safeguards

- The API key lives only in an ignored `.env`. Logs hold no document text, questions or answers.
- Citations are checked against stored text, and spend is limited by rate limits, caching and output caps (see `GET /metrics/ai-usage`).
- Not covered: whether every sentence truly follows from its source is not evaluated automatically.
