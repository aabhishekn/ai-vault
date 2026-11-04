import { DocumentList } from '../features/documents/DocumentList'
import { ConnectionDetails } from '../features/health/ConnectionDetails'
import './App.css'

export default function App() {
  return (
    <div className="workspace">
      <header className="workspace-header">
        <a className="brand" href="/" aria-label="AI Vault home">
          <span className="brand-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <circle cx="12" cy="12" r="3" />
              <path d="M12 7v2m0 6v2m-5-5h2m6 0h2" />
            </svg>
          </span>
          AI Vault
        </a>
        <span className="workspace-label">
          <span aria-hidden="true" />
          Local workspace
        </span>
      </header>

      <main className="workspace-main">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1>
          Room for your
          <br />
          next idea.
        </h1>
        <p className="workspace-intro">
          Your documents, gathered in one place. See what’s arrived and where
          each one stands.
        </p>
        <DocumentList />
        <ConnectionDetails />
      </main>

      <footer className="workspace-footer">
        A little order. A lot of possibility.
      </footer>
    </div>
  )
}
