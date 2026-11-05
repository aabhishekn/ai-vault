# AI usage

How AI tools helped build AI Vault, and where I had to correct them. The AI features inside the product are described in [docs/architecture.md](docs/architecture.md).

## Tools

| Tool | Used for |
| --- | --- |
| **Codex** (ChatGPT desktop app) | The first build: backend, database, upload, worker, text extraction, chunking, embeddings, search, cited answers, first screens |
| **Claude Code** | Code reviews and fixes, chat UI, cost tracking, logging, rate limiting, job recovery, the bonus features, cleanup, docs |
| **OpenAI API** | Inside the product: embeddings, answers, summaries, insights |

I did not use Cursor or Copilot.

## How I worked

- **Small steps.** About 100 commits over three days. Each one is a single feature: build, test, commit.
- **I made the decisions:** the stack, LlamaIndex for retrieval, what to build first.
- **Everything is tested.** About 380 backend and 535 frontend tests, lint, a migration check and CI. Tests never call the paid API.
- **Reviews and gap checks.** I paused feature work several times to review the whole codebase, and went through the case study point by point to find what was missing.

## Where AI was wrong

- **It rushed.** Codex started installing things before explaining. I stopped it and we agreed to explain first.
- **First code needed review.** A whole-backend review found a worker crash that left documents stuck in `processing`, full text loaded on every lookup, and embeddings off by default, so a fresh clone could never search. All fixed with tests.
- **Missing features.** The first version made summaries only on request, and had no cost tracking, rate limiting or detailed logging. I found these by re-reading the case study.
- **Weak answers.** Asking real questions showed that a change of subject was searched with the old topic, "each document" skipped some documents, and a stray character from a PDF broke saving. The model also accepted a false premise ("the Node.js server" in a FastAPI project) and defended it when challenged. Each is fixed and tested.
- **Docs that disagreed with the code.** The AI wrote limitations the code did not have. Re-reading them against the code fixed that.

## Safeguards

- The API key lives only in an ignored `.env`. Logs hold no document text, questions or answers.
- Citations are checked against stored text, and spend is limited by rate limits, caching and output caps (see `GET /metrics/ai-usage`).
- Not covered: whether every sentence truly follows from its source is not evaluated automatically.
