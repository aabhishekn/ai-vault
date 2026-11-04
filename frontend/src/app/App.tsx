import { DocumentWorkspace } from '../features/documents/DocumentWorkspace'
import { AnalyticsPanel } from '../features/analytics/AnalyticsPanel'
import { ConnectionDetails } from '../features/health/ConnectionDetails'

export default function App() {
  return (
    <div className="flex min-h-svh flex-col px-[6.5%] max-[600px]:px-[22px]">
      <header className="flex h-[104px] items-center justify-between border-b border-divider max-[600px]:h-[82px]">
        <a
          className="inline-flex items-center gap-[11px] text-[21px] font-bold tracking-[-0.8px] no-underline"
          href="/"
          aria-label="AI Vault home"
        >
          <span
            className="grid size-[38px] place-items-center rounded-[11px] bg-brand text-[#f6f6ed] [&_svg]:size-7"
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
        <span className="inline-flex items-center gap-2 text-xs font-medium text-muted max-[600px]:text-[11px]">
          <span
            className="size-1.5 rounded-full bg-[#a0aa93]"
            aria-hidden="true"
          />
          Local workspace
        </span>
      </header>

      <main className="mx-auto w-full max-w-[940px] pt-14 pb-[54px] max-[600px]:pt-12">
        <p className="mb-[18px] text-[11px] font-[650] tracking-[2.3px] text-earth">
          YOUR WORKSPACE
        </p>
        <h1 className="font-serif text-[clamp(46px,6vw,68px)] leading-[1.08] font-normal tracking-[-2.8px] max-[600px]:tracking-[-1.8px]">
          Room for your
          <br />
          next idea.
        </h1>
        <p className="mt-[22px] mb-[34px] max-w-[420px] text-[15px] leading-[1.75] text-muted">
          Your documents, gathered in one place. See what’s arrived and where
          each one stands.
        </p>
        <DocumentWorkspace />
        <AnalyticsPanel />
        <ConnectionDetails />
      </main>

      <footer className="mt-auto pb-7 text-center text-[11px] tracking-[0.2px] text-muted">
        A little order. A lot of possibility.
      </footer>
    </div>
  )
}
