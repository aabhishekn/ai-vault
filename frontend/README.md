# AI Vault frontend

React + Vite + Tailwind CSS (plain JavaScript). The look is a warm cream canvas with a terracotta accent. Source Serif 4 sets headings and the model-written text (answers, summaries, insights, comparisons) and Inter sets the interface; both are self-hosted through `@fontsource-variable` packages, so nothing loads from a CDN. Colors live in the `@theme` block of `src/styles.css`. The workspace uploads PDFs and lists documents with processing status, size, upload time, and pagination.

From this directory:

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API running on localhost:8000. The list loads ten documents at a time. **Previous** and **Next** navigate pages; the refresh icon reloads the current page. Empty lists and disappeared last pages are handled. Loading, failure, invalid-response, and timeout states are handled. Requests are cancelled when the component unmounts. No AI request is involved.

## Upload a document

Choose a PDF, PNG or JPG, then select **Upload**. The form checks the extension, nonempty size, filename length, and 10 MiB limit (shown as 10 MB). The server validates the actual file header and enforces the size limit. A PDF with no text layer and any picture are read as images by the server's vision model, which the form says. A document that fails shows the server's reason (`error_message`) in its details. While the file uploads, a pulsing **Uploading** row appears at the top of the first page (unfiltered); on success the saved document replaces it without reloading the list, and on failure the row is removed and the form explains why. Past the first page or with a filter on, the list returns to the first page once the upload is saved. Processing happens in the existing background worker; use **Refresh** to update statuses.

The file input and submit button are disabled during upload. Uploads time out after 60 seconds and are cancelled on unmount; cancelling the browser request does not undo a server save. Failed or unconfirmed requests are never retried automatically. If the connection or queue fails after a save, feedback asks you to refresh the list before uploading again. The backend currently has no upload idempotency mechanism.

## Document details

Documents are listed by their `title` when they have one (written by the AI during classification, or set with **Rename** in the details dialog; it saves instantly and rolls back with the typed text kept if refused). Without one they are listed by a readable version of the file name: the file name without `.pdf`, with underscores turned into spaces (and `_ ` back into a colon, which operating systems substitute in file names). The exact file name is the tooltip on the title and the **File name** line on the **Details** tab. Select a document title to open its details dialog. It fetches fresh metadata from `GET /documents/{id}`, validates that the returned ID matches the selected document, and shows status, size and upload time. The dialog has **Ask**, **Summary** and **Details** tabs (all kept mounted, so a half-typed question survives switching); it opens on **Ask** for a document that can be asked about and on **Details** otherwise. Status changes arrive over the live connection, so there is no manual refresh. Close or press Escape to return to the same list and page. The modal contains keyboard focus and restores it to the selected filename on close.

Loading, missing documents, invalid responses, and connection failures have dedicated feedback. Details requests time out after ten seconds and are cancelled when the dialog closes. Selection is local UI state; reloading the page closes the dialog. PDF preview is a separate future step.

## Saved summaries

Document details include a **Saved summary** section. Opening the **Summary** tab reads `GET /documents/{id}/summary`; it never generates content or calls the AI provider. Summary text is rendered as plain text with paragraph breaks preserved. No summary yet, loading, invalid data, and service failures have distinct states. **Check saved summary** (shown only after a failure) recovers without closing the dialog or replacing the document metadata.

The backend returns 404 for both a missing summary and a missing document. On that response, the summary API confirms the document exists before showing an empty state. Responses must match the selected document ID. Requests time out after ten seconds and are cancelled on unmount; switching documents cannot display a previous document’s result.

## Generate a summary

When no saved summary exists, **Generate summary** is available for documents whose status is extracted, embedded, or ready. Its cost note explains that document text is sent to the configured AI provider and API charges may apply. A click submits `POST /documents/{id}/summary`; opening details and refreshing continue to use GET only. Completed results are cached by the backend and immediately shown in the summary section.

The summary hook configures the shared generated-content lifecycle, which owns both reading and generation. A request ref prevents repeated submissions, refresh is unavailable while generation runs, and generation has a two-minute browser timeout. A failed or unconfirmed generation must be followed by **Check saved summary** before the UI allows another attempt. No frontend generation request is automatically retried. Closing or refreshing document details cancels the browser request; the server may still finish saving the result. Concurrent requests from other tabs can still generate more than once before a cache entry exists; backend deduplication is not implemented here.

## Saved insights

Document details include **Insights**, loaded independently from metadata and the summary. Each card displays the insight, source page number, and quoted evidence as plain text. **Check saved insights** (shown only after a failure) reads the saved result without calling the AI provider. No saved insights, a saved empty result, malformed data, and service failures are handled separately. When no saved result exists and extracted text is available, **Generate insights** sends one POST request. Its note explains document-text sharing and possible API charges. Results appear immediately with page references and evidence. A saved empty result is shown explicitly and does not offer regeneration.

The insights API validates the selected document ID, nonempty insight/evidence text, and positive integer page numbers. It shares the missing-content lookup with summaries so a deleted document is not presented as simply missing generated content. Page labels are references, not PDF navigation links; PDF preview is not implemented.

## Generate insights

`POST /documents/{id}/insights` uses the existing backend generation and cache. Opening details and checking saved insights use GET only. Eligibility matches summary generation: extracted, embedded, or ready. The shared lifecycle blocks duplicate submissions and refresh while generating, applies a two-minute browser timeout, and cancels pending requests when details close or the document changes. After failure, **Check saved insights** must finish before another generation can be attempted. The server may still save a result after browser cancellation; requests from other tabs are not deduplicated by this frontend guard.

## Ask a document

The chat (`ChatPane` with `ChatThread`) is one persistent pane. `scope.js` decides what it asks: the ticked documents, or every `embedded`/`ready` document (newest ten, the backend's limit) when none is ticked; `useReadyDocuments.js` finds those across pages (the visible page when it holds everything, otherwise one `limit=100` request). One document is a saved multi-turn conversation restored on return; two or more is one multi-document conversation. The "all" scope keeps one key while documents finish processing, so a thread in progress is never reset in the background. Other statuses show why questions are unavailable. The question box validates trimmed, nonempty questions up to 2,000 characters. The conversation is created on the first question (`POST /documents/{id}/conversations`, or `POST /multi-conversations` with the document IDs for several), then each question and follow-up is a `POST /conversations/{id}/messages/stream` with `top_k: 3`, read as server-sent events so the answer appears as it is written and is replaced by the validated, cited turn when it completes. Nothing is requested just by opening the page except the saved conversation of a single document. Questions use the configured AI provider for retrieval and answer generation; the form explains text sharing and possible charges.

Answers show the submitted question, plain-text response, and expandable sources labelled with the same citation numbers and page numbers used in the answer. Citation text is the backend's retrieved passage. The client checks the returned document ID, echoed question, citation fields, uniqueness, and correspondence between answer labels and source numbers before displaying a result. Insufficient evidence has its own state and no invented source links.

The hook prevents duplicate submissions, times out after two minutes, and cancels browser requests when the chat's scope changes. Failures are not retried automatically; submitting again starts a new request and may incur charges. The server may finish work after browser cancellation. Turns are saved on the server and the backend uses the latest three as follow-up context. When a single document becomes the chat's scope, the UI reads `GET /documents/{id}/conversations?limit=1&has_turns=true` and then that conversation's history (no AI call) to restore the latest conversation, and follow-ups continue in it. If restoring fails, asking a new question still works. **New conversation** starts a fresh one while the old one stays saved. A failed follow-up keeps the draft and earlier turns. Draft edits do not relabel an existing answer.

## Structure

- `src/main.jsx` and `src/app/App.jsx`: entry point and shell (header with the **Metrics** button, then the workspace).
- `src/components/`: `Button.jsx` and `Tabs.jsx` (accessible `TabList` and `TabPanel`).
- `src/hooks/useResource.js`: loading, timeout, cancellation, key isolation, refresh and merge for one fetched resource.
- `src/lib/`: `api.js` (the shared fetch entry point: JSON, and bodiless 204 responses), `format.js` (titles, dates, file sizes) and `liveUpdates.js` (the WebSocket event contract).
- `src/styles.css`: Tailwind entry point, shared theme tokens, and global base/focus styles.
- `src/features/documents/`, grouped by job:
  - **Screen:** `DocumentWorkspace.jsx` (the two-pane screen and the owner of list state, ticked documents and the open document), `DocumentList.jsx`, `DocumentRow.jsx`, `DocumentFilters.jsx`, `filters.js`, `DocumentUpload.jsx`, `DocumentStatusBadge.jsx`, `status.js`, `types.js`.
  - **Chat:** `ChatPane.jsx` (scope chips, **Use all documents**, **Compare**, empty states), `ChatThread.jsx` (one conversation: thread, starters, question box, cost note), `AnswerResult.jsx`, `scope.js` and `useReadyDocuments.js` (what the chat asks about), `useDocumentChat.js`, `conversations.js`, `answers.js`, `useSuggestedQuestions.js` and `suggestions.js`, `ComparisonDialog.jsx` and `comparison.js`.
  - **Document dialog:** `DocumentDetails.jsx` (tabs and focus lifecycle), `useDocument.js`, `DocumentTitle.jsx`, `DocumentTags.jsx`, `TagChips.jsx`, `classification.js`, `DocumentSummary.jsx` with `CustomSummary.jsx`, `DocumentInsights.jsx`, `DocumentVersions.jsx` with `versions.js`, `DocumentActions.jsx` with `manage.js`.
  - **Saved content:** `summary.js`, `insights.js`, `customSummaryApi.js`, `useDocumentSummary.js`, `useDocumentInsights.js`, `useCustomSummary.js`, `useGeneratedDocumentContent.js` (shared saved-content reads and explicit generation, with request guards, timeouts and cancellation), `savedContent.js`.
  - **List data and updates:** `api.js` (validated list and detail requests), `useDocuments.js`, `useTagsOverview.js`, `upload.js` and `useUploadDocument.js`, `optimistic.js` and `useOptimisticDocuments.js` (a small overlay shows uploads, deletes, renames and **Process again** at once and rolls back when the server refuses), `useLiveUpdates.js` and `changeBatcher.js` (WebSocket events batched into list refreshes).
- `src/features/health/`: `queue.js`, `useQueueHealth.js` and `WorkerNotice.jsx`; polls `GET /health/queue` every 30 s and shows a notice when no worker is running (a failed check shows nothing).
- `src/features/overview/`: `MetricsDialog.jsx`, `OverviewPanel.jsx`, `overview.js` and `useOverview.js`.

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

Vitest verifies response validation, pagination parameters, cancellation signal forwarding, safe error messages, upload size boundaries, multipart data, unconfirmed saves, and summary/insight generation contracts without live API calls. React Testing Library also checks lifecycle guards, cancellation, document switching, recovery, citation rendering, and focus after generation. CI runs all four checks. The lockfile pins installed dependencies; use `npm ci` for repeatable installs. The proxy applies to the development server. A production deployment will need its own `/api` routing; deployment is not configured in this step.

## Workspace overview

`src/features/overview/` reads `GET /stats/documents` and `GET /metrics/processing`. `overview.js` validates the responses (non-negative counts, status totals matching the document total, rates between 0 and 1) and maps them to camelCase, `useOverview.js` loads each independently so one failure never hides the other, and `OverviewPanel.jsx` renders them with loading, error, empty, and refresh states, inside `MetricsDialog.jsx`, which the header's **Metrics** button opens and which is mounted only while open, so nothing is requested until then. Neither endpoint calls the AI provider.
