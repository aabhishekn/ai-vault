# AI Vault frontend

React + TypeScript + Vite. The workspace uploads PDFs and lists documents with processing status, size, upload time, and pagination.

From this directory:

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API running on localhost:8000. The list loads ten documents at a time. **Previous** and **Next** navigate pages; **Refresh** reloads the current page. Empty lists and disappeared last pages are handled. Expand **Service connection** to check backend health; **Check again** retries it. Loading, failure, invalid-response, and timeout states are handled. Requests are cancelled when the component unmounts. No AI request is involved.

## Upload a PDF

Choose a PDF, then select **Upload PDF**. The form checks the extension, nonempty size, filename length, and 10 MiB limit (shown as 10 MB). The server validates the actual PDF header and enforces the size limit. On success, the picker clears and the list returns to the first page to show the new document. Processing happens in the existing background worker; use **Refresh** to update statuses.

The file input and submit button are disabled during upload. Uploads time out after 60 seconds and are cancelled on unmount; cancelling the browser request does not undo a server save. Failed or unconfirmed requests are never retried automatically. If the connection or queue fails after a save, feedback asks you to refresh the list before uploading again. The backend currently has no upload idempotency mechanism.

## Document details

Select a document filename to open its details dialog. It fetches fresh metadata from `GET /documents/{id}`, validates that the returned ID matches the selected document, and shows status, size, type, upload time, and ID. **Refresh details** checks for processing updates without an AI call. Close or press Escape to return to the same list and page. The modal contains keyboard focus and restores it to the selected filename on close.

Loading, missing documents, invalid responses, and connection failures have dedicated feedback. Details requests time out after ten seconds and are cancelled when the dialog closes. Selection is local UI state; reloading the page closes the dialog. PDF preview and summary generation are separate future steps.

## Saved summaries

Document details include a **Saved summary** section. Opening it or using **Refresh summary** reads `GET /documents/{id}/summary`; it never generates content or calls the AI provider. Summary text is rendered as plain text with paragraph breaks preserved. No summary yet, loading, invalid data, and service failures have distinct states. **Retry summary** recovers without closing the dialog or replacing the document metadata.

The backend returns 404 for both a missing summary and a missing document. On that response, the summary API confirms the document exists before showing an empty state. Responses must match the selected document ID. Requests time out after ten seconds and are cancelled on unmount; switching documents cannot display a previous document’s result.

## Structure

- `src/app/`: application layout.
- `src/features/documents/DocumentWorkspace.tsx`: composes upload, list, and details; owns list state and selected document ID.
- `src/features/documents/summary.ts`: saved-summary API contract and missing-content handling.
- `src/features/documents/useSavedSummary.ts`: independent summary loading, cancellation, and refresh.
- `src/features/documents/DocumentSummary.tsx`: summary, empty state, and retry UI.
- `src/features/documents/useDocument.ts`: selected-document request lifecycle and refresh.
- `src/features/documents/DocumentDetails.tsx`: metadata dialog and focus lifecycle.
- `src/features/documents/upload.ts`: upload validation and multipart API request.
- `src/features/documents/useUploadDocument.ts`: upload lifecycle, timeout, duplicate-submit guard, and cancellation.
- `src/features/documents/DocumentUpload.tsx`: accessible file picker, form, and feedback.
- `src/features/documents/`: document types, validated API requests, loading/pagination hook, list, rows, and status badges.
- `src/components/`: shared UI primitives such as Button.
- `src/lib/format.ts`: date and file-size display helpers.
- `src/features/health/`: health API contract and connection component.
- `src/lib/api.ts`: shared fetch entry point for future feature APIs.
- `src/styles.css`: base styles.

API modules validate unknown JSON, hooks own request lifecycle, and components render state. Feature components do not call fetch directly.

The browser requests `/api/documents` and `/api/health`. Vite's development proxy forwards requests to `http://127.0.0.1:8000` and strips `/api`; API keys stay on the Python side. See the [Vite proxy documentation](https://vite.dev/config/server-options.html#server-proxy).

## Checks

```bash
npm run lint
npm run format:check
npm test
npm run build
```

Vitest verifies response validation, pagination parameters, cancellation signal forwarding, safe error messages, upload size boundaries, multipart data, and unconfirmed saves and saved-summary contracts without live API calls. CI runs all four checks. TypeScript strict mode is enabled. The lockfile pins installed dependencies; use `npm ci` for repeatable installs. The proxy applies to the development server. A production deployment will need its own `/api` routing; deployment is not configured in this step.
