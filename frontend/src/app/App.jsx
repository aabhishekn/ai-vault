import { DocumentWorkspace } from '../features/documents/DocumentWorkspace'
import { OverviewPanel } from '../features/overview/OverviewPanel'

export default function App() {
  return (
    <div className="flex min-h-svh flex-col px-[6.5%] max-[600px]:px-[22px]">
      <header className="flex h-[76px] items-center justify-between border-b border-divider">
        <a
          className="inline-flex items-center gap-[11px] text-[21px] font-bold tracking-[-0.8px] no-underline"
          href="/"
          aria-label="AI Vault home"
        >
          <span
            className="grid size-[38px] place-items-center rounded-[11px] bg-brand text-[#fffaf5] [&_svg]:size-7"
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
      </header>

      <main className="mx-auto w-full max-w-[940px] pt-10 pb-[54px]">
        <h1 className="font-serif text-[clamp(34px,5vw,48px)] leading-[1.1] font-normal tracking-[-0.03em]">
          Ask your documents.
        </h1>
        <p className="mt-3 mb-8 max-w-[540px] text-[15px] leading-[1.7] text-muted">
          Upload PDFs, get summaries and insights, and chat with answers that
          cite the page they came from.
        </p>
        <DocumentWorkspace />
        <OverviewPanel />
      </main>

      <footer className="mt-auto pb-7 text-center text-[11px] tracking-[0.2px] text-muted">
        Answers are generated from your documents and cite their sources.
      </footer>
    </div>
  )
}
