import { HealthCard } from '../features/health/HealthCard'
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
        <p className="eyebrow">THE FOUNDATION</p>
        <h1>
          A good place
          <br />
          to start.
        </h1>
        <p className="workspace-intro">
          Your vault is taking shape. First, let’s make sure your workspace and
          document service are connected.
        </p>
        <HealthCard />
      </main>

      <footer className="workspace-footer">
        A little order. A lot of possibility.
      </footer>
    </div>
  )
}
