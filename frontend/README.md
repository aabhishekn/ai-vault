# AI Vault frontend

React + TypeScript + Vite. This first screen verifies the connection to the existing Python backend.

From this directory:

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the API running on localhost:8000. A connection check runs on page load; **Check again** retries it. Loading, failure, invalid-response, and timeout states are handled. Requests are cancelled when the component unmounts. No AI request is involved.

## Structure

- `src/app/`: application layout.
- `src/features/health/`: health API contract and connection component.
- `src/lib/api.ts`: shared fetch entry point for future feature APIs.
- `src/styles.css`: base styles.

The browser requests `/api/health`. Vite's development proxy forwards it to `http://127.0.0.1:8000/health`; API keys stay on the Python side. See the [Vite proxy documentation](https://vite.dev/config/server-options.html#server-proxy).

## Checks

```bash
npm run lint
npm run format:check
npm run build
```

TypeScript strict mode is enabled. The lockfile pins installed dependencies; use `npm ci` for repeatable installs. The proxy applies to the development server. A production deployment will need its own `/api` routing; deployment is not configured in this step.
