# AI Vault frontend

React + TypeScript + Vite + Tailwind CSS. The workspace uploads PDFs and lists documents with processing status, size, upload time, and pagination.

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

Loading, missing documents, invalid responses, and connection failures have dedicated feedback. Details requests time out after ten seconds and are cancelled when the dialog closes. Selection is local UI state; reloading the page closes the dialog. PDF preview is a separate future step.

## Saved summaries

Document details include a **Saved summary** section. Opening it or using **Refresh summary** reads `GET /documents/{id}/summary`; it never generates content or calls the AI provider. Summary text is rendered as plain text with paragraph breaks preserved. No summary yet, loading, invalid data, and service failures have distinct states. **Retry summary** recovers without closing the dialog or replacing the document metadata.

The backend returns 404 for both a missing summary and a missing document. On that response, the summary API confirms the document exists before showing an empty state. Responses must match the selected document ID. Requests time out after ten seconds and are cancelled on unmount; switching documents cannot display a previous document’s result.

## Generate a summary

When no saved summary exists, **Generate summary** is available for documents whose status is extracted, embedded, or ready. Its cost note explains that document text is sent to the configured AI provider and API charges may apply. A click submits `POST /documents/{id}/summary`; opening details and refreshing continue to use GET only. Completed results are cached by the backend and immediately shown in the summary section.

The summary hook configures the shared generated-content lifecycle, which owns both reading and generation. A request ref prevents repeated submissions, refresh is unavailable while generation runs, and generation has a two-minute browser timeout. A failed or unconfirmed generation must be followed by **Check saved summary** before the UI allows another attempt. No frontend generation request is automatically retried. Closing or refreshing document details cancels the browser request; the server may still finish saving the result. Concurrent requests from other tabs can still generate more than once before a cache entry exists; backend deduplication is not implemented here.

## Saved insights

Document details include **Insights**, loaded independently from metadata and the summary. Each card displays the insight, source page number, and quoted evidence as plain text. **Refresh insights** reads the saved result without calling the AI provider. No saved insights, a saved empty result, malformed data, and service failures are handled separately. When no saved result exists and extracted text is available, **Generate insights** sends one POST request. Its note explains document-text sharing and possible API charges. Results appear immediately with page references and evidence. A saved empty result is shown explicitly and does not offer regeneration.

The insights API validates the selected document ID, nonempty insight/evidence text, and positive integer page numbers. It shares the missing-content lookup with summaries so a deleted document is not presented as simply missing generated content. Page labels are references, not PDF navigation links; PDF preview is not implemented.

## Generate insights

`POST /documents/{id}/insights` uses the existing backend generation and cache. Opening details and refreshing insights use GET only. Eligibility matches summary generation: extracted, embedded, or ready. The shared lifecycle blocks duplicate submissions and refresh while generating, applies a two-minute browser timeout, and cancels pending requests when details close or the document changes. After failure, **Check saved insights** must finish before another generation can be attempted. The server may still save a result after browser cancellation; requests from other tabs are not deduplicated by this frontend guard.

## Ask a document

**Ask this document** supports independent questions for `embedded` and `ready` documents. Other statuses show why questions are unavailable. The form validates trimmed, nonempty questions up to 2,000 characters and sends `POST /documents/{id}/ask` as JSON with `top_k: 3`. No request runs on mount. Questions use the configured AI provider for retrieval and answer generation; the form explains text sharing and possible charges.

Answers show the submitted question, plain-text response, and expandable sources labelled with the same citation numbers and page numbers used in the answer. Citation text is the backend's retrieved passage. The client checks the returned document ID, echoed question, citation fields, uniqueness, and correspondence between answer labels and source numbers before displaying a result. Insufficient evidence has its own state and no invented source links.

The hook prevents duplicate submissions, times out after two minutes, and cancels browser requests when details close or change documents. Failures are not retried automatically; submitting again starts a new request and may incur charges. The server may finish work after browser cancellation. Each question is independent, and the answer is not stored by this endpoint; saved multi-turn conversations are a separate future step. Draft edits do not relabel an existing answer, and closing or refreshing details clears the question UI.

## Structure

- `src/app/`: application layout.
- `src/features/documents/DocumentWorkspace.tsx`: composes upload, list, and details; owns list state and selected document ID.
- `src/features/documents/answers.ts`: question eligibility/validation, JSON requests, and answer/citation validation.
- `src/features/documents/useDocumentAnswer.ts`: explicit submission, request guard, cancellation, and timeout.
- `src/features/documents/DocumentQuestion.tsx`: question form, cost explanation, loading/error feedback, and focus.
- `src/features/documents/AnswerResult.tsx`: submitted question, answer, and expandable source passages.
- `src/features/documents/summary.ts`: validated read/generation requests, processing-status eligibility, and safe API errors.
- `src/features/documents/useDocumentSummary.ts`: summary lifecycle configuration through the shared generated-content hook.
- `src/features/documents/DocumentSummary.tsx`: summary, empty state, and retry UI.
- `src/features/documents/useDocument.ts`: metadata loading through the shared resource hook.
- `src/features/documents/insights.ts`: saved/generated insight validation, processing-status eligibility, and safe API requests.
- `src/features/documents/useDocumentInsights.ts`: insight lifecycle configuration.
- `src/features/documents/useGeneratedDocumentContent.ts`: shared saved-content reads and explicit generation, with request guards, timeouts, cancellation, and document isolation.
- `src/features/documents/DocumentInsights.tsx`: independent insight cards, generation, empty states, and recovery.
- `src/features/documents/savedContent.ts`: shared summary/insights missing-content handling.
- `src/hooks/useResource.ts`: metadata loading, timeout, cancellation, key isolation, and refresh.
- `src/features/documents/DocumentDetails.tsx`: metadata dialog and focus lifecycle.
- `src/features/documents/upload.ts`: upload validation and multipart API request.
- `src/features/documents/useUploadDocument.ts`: upload lifecycle, timeout, duplicate-submit guard, and cancellation.
- `src/features/documents/DocumentUpload.tsx`: accessible file picker, form, and feedback.
- `src/features/documents/`: document types, validated API requests, loading/pagination hook, list, rows, and status badges.
- `src/components/`: shared UI primitives such as Button.
- `src/lib/format.ts`: date and file-size display helpers.
- `src/features/health/`: health API contract and connection component.
- `src/lib/api.ts`: shared fetch entry point for future feature APIs.
- `src/styles.css`: Tailwind entry point, shared theme tokens, and global base/focus styles.

API modules validate unknown JSON, hooks own request lifecycle, and components render state. Feature components do not call fetch directly.

The browser requests `/api/documents` and `/api/health`. Vite's development proxy forwards requests to `http://127.0.0.1:8000` and strips `/api`; API keys stay on the Python side. See the [Vite proxy documentation](https://vite.dev/config/server-options.html#server-proxy).

## Styling

Tailwind CSS is compiled by `@tailwindcss/vite`, following the [official Vite integration](https://tailwindcss.com/docs/installation/using-vite). Components use utility classes; `src/styles.css` defines shared colors, fonts, and shadows with `@theme`. For example, `bg-surface` and `text-muted` refer to those theme tokens. The existing 600 px mobile breakpoint is preserved with `max-[600px]:` variants.

Use `Button` with its `primary` or default `secondary` variant for shared button appearance. Status colors use complete class strings in typed maps so Tailwind can discover every state at build time. Keep request logic in hooks and API modules; styling belongs in components. Add shared UI components when a repeated UI pattern needs reuse rather than copying large blocks. Prettier's Tailwind plugin sorts utility classes automatically when running `npm run format`.

Only theme definitions and global base rules remain in CSS. Feature styles live alongside their markup; there are no component-specific stylesheets. Tailwind generates the final browser CSS during development and production builds.

## Checks

```bash
npm run lint
npm run format:check
npm test
npm run build
```

Vitest verifies response validation, pagination parameters, cancellation signal forwarding, safe error messages, upload size boundaries, multipart data, unconfirmed saves, and summary/insight generation contracts without live API calls. React Testing Library also checks lifecycle guards, cancellation, document switching, recovery, citation rendering, and focus after generation. CI runs all four checks. TypeScript strict mode is enabled. The lockfile pins installed dependencies; use `npm ci` for repeatable installs. The proxy applies to the development server. A production deployment will need its own `/api` routing; deployment is not configured in this step.
