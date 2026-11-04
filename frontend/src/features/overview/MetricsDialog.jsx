import { useEffect, useRef } from 'react'
import { OverviewPanel } from './OverviewPanel'

// The workspace numbers, out of the way until asked for. Mounted only while open, so the
// figures are read when it opens and nothing is fetched otherwise.
export function MetricsDialog({ onClose }) {
  const dialog = useRef(null)

  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="m-auto max-h-[calc(100svh-40px)] w-[min(680px,calc(100%-32px))] overflow-auto rounded-[18px] border border-panel-border bg-surface p-0 text-ink shadow-[0_24px_100px_#14141326] backdrop:bg-[#141413b3]"
      aria-label="Workspace metrics"
      onCancel={onClose}
    >
      <button
        type="button"
        className="absolute top-3.5 right-3.5 z-10 grid size-9 cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-[#efede4] hover:text-ink"
        aria-label="Close"
        onClick={onClose}
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
      <div className="p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]">
        <OverviewPanel />
      </div>
    </dialog>
  )
}
