# AI Vault

A document management application for uploading documents, generating AI insights, and asking questions with source citations.

## Project status

Minimal FastAPI backend with a health endpoint.

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
