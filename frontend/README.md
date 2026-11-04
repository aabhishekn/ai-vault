# AI Vault frontend

React + TypeScript + Vite. The workspace lists documents with processing status, size, upload time, and pagination.

From this directory:

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API running on localhost:8000. The list loads ten documents at a time. **Previous** and **Next** navigate pages; **Refresh** reloads the current page. Empty lists and disappeared last pages are handled. Expand **Service connection** to check backend health; **Check again** retries it. Loading, failure, invalid-response, and timeout states are handled. Requests are cancelled when the component unmounts. No AI request is involved.

## Structure

- `src/app/`: application layout.
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

Vitest verifies response validation, pagination parameters, cancellation signal forwarding, and safe error messages without live API calls. CI runs all four checks. TypeScript strict mode is enabled. The lockfile pins installed dependencies; use `npm ci` for repeatable installs. The proxy applies to the development server. A production deployment will need its own `/api` routing; deployment is not configured in this step.
