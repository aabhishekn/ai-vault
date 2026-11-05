# AI Vault frontend

The web app for AI Vault: upload, search, read, chat with, compare and manage documents. React 19, Vite, Tailwind CSS 4 and Vitest, in plain JavaScript. The API it talks to is described in [docs/api.md](../docs/api.md); the whole project is in the [root README](../README.md).

<hr>

## Quick start

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API running on port 8000. The dev server proxies `/api` (including the WebSocket) to the API and strips the prefix, so API keys stay on the Python side. To use another API address, set `VITE_API_TARGET`. Production routing for `/api` is not configured.

| Command                | Does                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Dev server with hot reload                                     |
| `npm run lint`         | oxlint, warnings are errors                                    |
| `npm run format:check` | Prettier (also sorts Tailwind classes; `npm run format` fixes) |
| `npm test`             | Vitest and React Testing Library; no live API calls            |
| `npm run build`        | Production build                                               |

CI runs lint, format check, tests and build on Node.js 24.

<hr>

## What the screen does

A **library on the left and one chat on the right**. On a narrow screen a **Chat | Documents** switch shows one pane at a time.

- **Library.** Choose or drop a PDF, PNG or JPG to upload. Rows show a readable title, size, upload time and a status badge, updated live; a notice appears when no worker is running. A search box matches title, file name or category (300 ms after typing stops). Uploads, deletes, renames and **Process again** show their result at once and roll back with a message if the server refuses. Previous/Next appear only when there is more than one page of ten.
- **Chat.** Tick documents to ask just those (one document is its own saved conversation, restored when you return; 2 to 10 is one conversation across them). Tick none to ask every search-ready document (the newest ten). Chips above the thread say what is being asked, with **Use all documents** and **Compare** (2 to 5 documents).
- **Answers** stream in. A label like `[2]` opens its source; sources are grouped by document and show the cited page and the passage that backs the answer. The last question can be edited and resent, and **New chat** starts afresh. Enter sends, Shift+Enter adds a line.
- **Greetings** such as "hi" or "thanks" are answered in the browser, so they cost nothing.
- **Document dialog** (select a title). **Summary** has the saved summary, a way to customize it (length, tone, focus; shown in place of the saved one, not saved) and the insights with page evidence. **Details** has the category, file name, size, **Versions** (upload a new one) and **Manage** (**Process again**, delete with confirmation). A document can be renamed here.
- **Metrics** in the header opens document statistics and processing metrics. Nothing is requested until it is opened.

Anything that calls the AI shows a note that document text is sent to the provider and charges may apply. Nothing is retried automatically, and generation requests time out after two minutes.

<hr>

## Project structure

```text
frontend/
├── src/
│   ├── main.jsx            Entry point
│   ├── styles.css          Theme tokens (colors, fonts) and global base rules
│   ├── app/                App shell
│   ├── components/         Shared UI: Button, Tabs, Working
│   ├── lib/                api (fetch), format, liveUpdates (WebSocket), useResource
│   └── features/
│       ├── documents/      The workspace, in one folder per job (below)
│       ├── health/         Notice when no worker is running
│       └── overview/       The Metrics dialog
├── public/                 favicon
├── index.html
├── vite.config.js          Dev server, /api proxy, Tailwind
├── vitest.config.js
└── package.json
```

The `documents/` feature is split by job. A test sits next to the file it covers.

| Folder      | Job                                             | Main files                                                                                                                                                                    |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (top level) | The workspace and what the folders share        | `DocumentWorkspace`, `api`, `manage`, `status`, `DocumentStatusBadge`                                                                                                         |
| `list/`     | The library: paging, search, optimistic updates | `DocumentList`, `DocumentRow`, `useDocuments`, `useOptimisticDocuments`, `optimistic`, `useLiveUpdates`, `changeBatcher`                                                      |
| `upload/`   | Upload form and file picker                     | `DocumentUpload`, `FilePicker`, `useUploadDocument`, `upload`                                                                                                                 |
| `details/`  | The document dialog: title, category, versions  | `DocumentDetails`, `DocumentTitle`, `DocumentCategory`, `DocumentVersions`, `DocumentActions`, `useDocument`, `classification`, `versions`                                    |
| `content/`  | Summaries, custom summaries, insights           | `DocumentSummary`, `CustomSummary`, `DocumentInsights`, `useDocumentSummary`, `useCustomSummary`, `useDocumentInsights`, `useGeneratedDocumentContent`, `summary`, `insights` |
| `chat/`     | Chat pane and thread, answers and citations     | `ChatPane`, `ChatThread`, `AnswerResult`, `QuestionEditor`, `useDocumentChat`, `useSuggestedQuestions`, `useReadyDocuments`, `conversations`, `answers`, `scope`, `smallTalk` |
| `compare/`  | The comparison dialog                           | `ComparisonDialog`, `comparison`                                                                                                                                              |

<hr>

## Backend routes used

| Feature           | Routes called                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library           | `GET /documents` (paging and `q` search), `GET /documents/{id}`                                                                                                                                |
| Upload            | `POST /documents`, `POST /documents/{id}/versions`                                                                                                                                             |
| Manage            | `PATCH /documents/{id}` (rename), `DELETE /documents/{id}`, `POST /documents/{id}/reprocess`                                                                                                   |
| Details           | `GET /documents/{id}/versions`, `POST /documents/{id}/classification`                                                                                                                          |
| Summary, insights | `GET` and `POST /documents/{id}/summary`, `GET` and `POST /documents/{id}/insights`, `POST /documents/{id}/summary/custom`                                                                     |
| Chat              | `GET` and `POST /documents/{id}/conversations`, `POST /multi-conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/messages/stream`, `POST /documents/{id}/suggested-questions` |
| Compare           | `POST /comparisons`                                                                                                                                                                            |
| Metrics           | `GET /stats/documents`, `GET /metrics/processing`                                                                                                                                              |
| Worker notice     | `GET /health/queue`                                                                                                                                                                            |
| Live status       | WebSocket `/ws/events`                                                                                                                                                                         |

The app does not call `/search`, `/ask`, `/metrics/ai-usage` or `/metrics/api`; they are for other API clients.

<hr>

## How the code works

Each feature has three layers:

| Layer      | Does                                                                                                | Example                                   |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| API module | Calls the backend and parses unknown JSON into the shape the UI needs, or throws a readable error   | `summary.js`, `conversations.js`          |
| Hook       | Owns the request lifecycle: loading, timeout, cancellation, no stale data after switching documents | `useDocumentSummary.js`, `useResource.js` |
| Component  | Renders state. It never calls `fetch` or casts server data                                          | `DocumentSummary.jsx`                     |

**Live updates.** `lib/liveUpdates.js` keeps a WebSocket open and reconnects with a growing delay (1 to 15 seconds). Events are hints, not state: `list/changeBatcher.js` groups them for 300 ms, then the current page of the list reloads quietly, the open document's details reload if it changed, and its versions list reloads so every version's status stays current. A document deleted elsewhere is also taken out of the chat's scope. After a reconnect everything reloads, because events sent while offline are not replayed.

**Styling** is Tailwind utilities in the markup. `src/styles.css` holds only the theme tokens (colors, fonts) and global base rules. Source Serif 4 sets model-written text and Inter sets the interface, both self-hosted.

**Shared UI** is used instead of copying blocks: `Button` (`primary` or default), `Tabs`, `Working` (the "AI is working" card).

<hr>

## Tests

37 test files, 540 tests, each next to the code it covers. They use Vitest and React Testing Library and never call the live API.

```bash
npm run lint && npm run format:check && npm test && npm run build
```
