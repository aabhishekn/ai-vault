import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ComparisonDialog } from './ComparisonDialog'
import { canAskDocument } from './answers'
import { MAX_COMPARED } from './comparison'
import { DocumentDetails } from './DocumentDetails'
import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { MultiDocumentChat } from './MultiDocumentChat'

import { useDocuments } from './useDocuments'
import { useQueueHealth } from '../health/useQueueHealth'
import { WorkerNotice } from '../health/WorkerNotice'
import { useLiveUpdates } from './useLiveUpdates'

const MAX_CHOSEN = 10

export function DocumentWorkspace() {
  const documents = useDocuments()
  const queue = useQueueHealth()
  const [selectedId, setSelectedId] = useState(null)
  // Documents chosen for a question across several (id -> filename).
  const [chosen, setChosen] = useState(new Map())
  const [asking, setAsking] = useState(false)
  const [comparing, setComparing] = useState(false)
  // Change counters for the open document, so its details reload when it changes.
  const [pushed, setPushed] = useState({ id: '', revision: 0, content: 0 })
  const selected = useRef(selectedId)
  useEffect(() => {
    selected.current = selectedId
  }, [selectedId])
  const connected = useLiveUpdates((changed) => {
    documents.refreshQuietly()
    const open = selected.current
    if (!open) return
    if (changed === null || changed.ids.has(open))
      setPushed((previous) => {
        const base =
          previous.id === open
            ? previous
            : { id: open, revision: 0, content: 0 }
        return {
          id: open,
          revision: base.revision + 1,
          content:
            changed === null || changed.content.has(open)
              ? base.content + 1
              : base.content,
        }
      })
  })
  const live =
    pushed.id === selectedId ? pushed : { id: '', revision: 0, content: 0 }

  // Only documents that can be asked about show a Select box.
  const askableCount =
    documents.state.status === 'success'
      ? documents.state.page.items.filter((item) => canAskDocument(item.status))
          .length
      : 0

  function choose(document) {
    setChosen((previous) => {
      const next = new Map(previous)
      if (next.has(document.id)) next.delete(document.id)
      else if (next.size < MAX_CHOSEN) next.set(document.id, document.filename)
      return next
    })
  }

  return (
    <>
      <DocumentUpload onUploaded={() => documents.goToPage(0)} />
      <WorkerNotice health={queue} />
      {chosen.size > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-evidence-border bg-[#f7f8f1] px-4 py-3 text-[13px]"
          role="status"
        >
          <span>
            {chosen.size} selected
            {chosen.size < 2 ? ' · choose at least two to ask across them' : ''}
            {chosen.size === MAX_CHOSEN ? ` · limit of ${MAX_CHOSEN}` : ''}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button onClick={() => setChosen(new Map())}>Clear</Button>
            <Button
              onClick={() => setComparing(true)}
              disabled={chosen.size < 2 || chosen.size > MAX_COMPARED}
              title={`Compare 2 to ${MAX_COMPARED} documents`}
            >
              Compare
            </Button>
            <Button onClick={() => setAsking(true)} disabled={chosen.size < 2}>
              Ask across documents
            </Button>
          </span>
        </div>
      )}
      {chosen.size === 0 && askableCount >= 2 && (
        <p className="mb-4 rounded-[12px] border border-dashed border-evidence-border px-4 py-3 text-[13px] text-muted">
          Tip: tick <strong className="font-semibold">Select</strong> on two or
          more documents to ask across them or compare them.
        </p>
      )}
      <DocumentList
        {...documents}
        onSelect={setSelectedId}
        chosen={chosen}
        onChoose={choose}
        live={connected}
      />
      {selectedId && (
        <DocumentDetails
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onOpen={setSelectedId}
          liveRevision={live.revision}
          contentRevision={live.content}
          onDeleted={() => {
            setChosen((previous) => {
              const next = new Map(previous)
              next.delete(selectedId)
              return next
            })
            setSelectedId(null)
            documents.refreshQuietly()
          }}
          onChanged={documents.refreshQuietly}
          onVersionAdded={(newId) => {
            documents.goToPage(0)
            setSelectedId(newId)
          }}
        />
      )}
      {comparing && (
        <ComparisonDialog
          key={[...chosen.keys()].join(',')}
          documents={chosen}
          onClose={() => setComparing(false)}
        />
      )}
      {asking && (
        <MultiDocumentChat
          key={[...chosen.keys()].join(',')}
          documents={chosen}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}
