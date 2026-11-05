# AI Vault frontend

React 19, Vite and Tailwind CSS 4, in plain JavaScript. It covers the whole workflow: upload, search, read, chat, compare and manage documents. For the API it talks to, see [docs/api.md](../docs/api.md).

## Run

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API on port 8000. The dev server proxies `/api` to it and strips the prefix, so API keys stay on the Python side. To use another API address, set `VITE_API_TARGET`. Production routing for `/api` is not configured.

| Command                | Does                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `npm run lint`         | oxlint, warnings are errors                                    |
| `npm run format:check` | Prettier (also sorts Tailwind classes; `npm run format` fixes) |
| `npm test`             | Vitest and React Testing Library; no live API calls            |
| `npm run build`        | Production build                                               |

CI runs all four. Node.js 24 is used there.

## What the screen does

The screen is a **library on the left and one chat on the right**. On a narrow screen a **Chat | Documents** switch shows one pane at a time.

- **Library.** Choose or drop a PDF, PNG or JPG to upload. Rows show a readable title, size, upload time and a status badge; statuses update live over a WebSocket, with a notice when no worker is running. A search box matches title, file name or category (300 ms after typing stops). Uploads, deletes, renames and **Process again** show their result at once and roll back with a message if the server refuses. Previous/Next appear only when there is more than one page of ten.
- **Chat.** Tick documents to ask just those (one document is its own saved conversation, restored when you return; 2 to 10 is one conversation across them). Tick none to ask every search-ready document (the newest ten). Chips above the thread say what is being asked, with **Use all documents** and **Compare** (2 to 5 documents).
- **Answers** stream in. A label like `[2]` opens its source; sources are grouped by document and show the cited page and the passage that backs the answer. The last question can be edited and resent, and **New chat** starts afresh. Enter sends, Shift+Enter adds a line.
- **Greetings** such as "hi" or "thanks" are answered in the browser, so they cost nothing.
- **Document dialog** (select a title). **Summary** has the saved summary, a way to customize it (length, tone, focus; shown in place of the saved one, not saved) and the insights with page evidence. **Details** has the category, file name, size, **Versions** (upload a new one) and **Manage** (**Process again**, delete with confirmation). A document can be renamed here.
- **Metrics** in the header opens document statistics and processing metrics. Nothing is requested until it is opened.

Anything that calls the AI shows a note that document text is sent to the provider and charges may apply. Nothing is retried automatically, and generation requests time out after two minutes.

## Structure

```text
src/
  main.jsx, app/        entry point and shell
  components/           Button, Tabs, Working (the shared "AI is working" card)
  lib/                  api (fetch), format, liveUpdates (WebSocket), useResource
  features/
    documents/          the workspace, in one folder per job:
      (top level)         DocumentWorkspace, shared api, manage, status
      list/               the library list, search, optimistic updates, live updates
      upload/             upload form and file picker
      details/            the document dialog: title, category, versions, actions
      content/            summaries, custom summaries, insights
      chat/               chat pane and thread, answers and citations, conversations
      compare/            the comparison dialog
    health/             worker-running notice
    overview/           the Metrics dialog
```

A test sits next to the file it covers.

## Conventions

- **API modules validate.** Each parses unknown JSON into the shape the UI needs and throws a readable error otherwise. Components never call `fetch` or cast server data.
- **Hooks own the request lifecycle** (loading, timeout, cancellation, no stale data after switching documents). Components render state.
- **Styling is Tailwind utilities** in the markup. `src/styles.css` holds only the theme tokens (colors, fonts) and global base rules. Source Serif 4 sets model-written text and Inter sets the interface, both self-hosted.
- **Shared UI** is used instead of copying blocks: `Button` (`primary` or default), `Tabs`, `Working`.
