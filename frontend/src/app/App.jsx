import { useState } from 'react'
import { Button } from '../components/Button'
import { DocumentWorkspace } from '../features/documents/DocumentWorkspace'
import { MetricsDialog } from '../features/overview/MetricsDialog'

export default function App() {
  const [metricsOpen, setMetricsOpen] = useState(false)
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-divider px-5">
        <a
          className="inline-flex items-center gap-[10px] text-[19px] font-bold tracking-[-0.7px] no-underline"
          href="/"
          aria-label="AI Vault home"
        >
          <span
            className="grid size-[32px] place-items-center rounded-[9px] bg-brand text-[#fffaf5] [&_svg]:size-6"
            aria-hidden="true"
          >
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
        <Button onClick={() => setMetricsOpen(true)} aria-haspopup="dialog">
          Metrics
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <DocumentWorkspace />
      </main>
      {metricsOpen && <MetricsDialog onClose={() => setMetricsOpen(false)} />}
    </div>
  )
}
