# AI Vault

A document management application for uploading documents, generating AI insights, and asking questions with source citations.

## Project status

Step 1: repository initialized. Application code and setup instructions will be added incrementally.

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
