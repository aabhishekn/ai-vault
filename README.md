# AI Vault

A document management application for uploading documents, generating AI insights, and asking questions with source citations.

## Project status

Minimal FastAPI backend with a health endpoint and local PostgreSQL via Docker Compose. Database integration with FastAPI is next.

## Planned stack

- Frontend: React, TypeScript, Vite
- Backend: Python, FastAPI
- Database: PostgreSQL with pgvector
- Background processing: RQ and Redis
- Document parsing: pdfplumber
- Storage: local filesystem for development

## Development approach

Build and verify one small feature at a time, starting with a health endpoint, then database access, uploads, background processing, and document chat.

Keep credentials in local environment files. Never commit API keys or uploaded documents.

## Run the backend

Requires Python 3.12. From the repository root:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Visit http://localhost:8000/health for the liveness response and http://localhost:8000/docs for interactive API documentation. The health endpoint checks only that the API is running. Stop the server with Ctrl+C.

## Local database

Start Docker Desktop. From the repository root, copy `.env.example` to `.env` if you do not already have one and replace its placeholder password. The local `.env` is ignored by Git.

```bash
docker compose up -d --wait db
docker compose ps
```

PostgreSQL is available at `127.0.0.1:5433`, with database/user `ai_vault`. The image includes pgvector for later document search; the extension will be enabled in a migration.

`postgres_data` is a named volume that retains database files across container restarts. Use `docker compose stop db` to stop it. `docker compose down` also retains the volume; adding `-v` deletes stored database data.

This step runs the database independently; FastAPI is not connected yet.
