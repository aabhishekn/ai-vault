import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ComparisonDialog } from './ComparisonDialog'
import { canAskDocument } from './answers'
import { MAX_COMPARED } from './comparison'
import { DocumentDetails } from './DocumentDetails'
import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { MultiDocumentChat } from './MultiDocumentChat'

import { documentTitle } from '../../lib/format'
import { useDocuments } from './useDocuments'
import { useOptimisticDocuments } from './useOptimisticDocuments'
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
  // Upload, delete and "process again" show their result before the server confirms.
  const optimistic = useOptimisticDocuments(documents, selected)

  // Only documents that can be asked about show a Select box.
  const askableCount =
    optimistic.view.status === 'success'
      ? optimistic.view.page.items.filter((item) => canAskDocument(item.status))
          .length
      : 0

  function choose(document) {
    setChosen((previous) => {
      const next = new Map(previous)
      if (next.has(document.id)) next.delete(document.id)
      else if (next.size < MAX_CHOSEN)
        next.set(document.id, documentTitle(document.filename))
      return next
    })
  }

  function deleteOpenDocument(id, filename) {
    setChosen((previous) => {
      const next = new Map(previous)
      next.delete(id)
      return next
    })
    setSelectedId(null)
    void optimistic.removeDocument(id, filename)
  }

  return (
    <>
      <DocumentUpload handlers={optimistic.upload} />
      <WorkerNotice health={queue} />
      {optimistic.problem && (
        <div
          className="sticky top-3 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#e6c9c3] bg-[#fffaf7] px-4 py-3 text-[13px] text-error shadow-panel"
          role="alert"
        >
          <span>{optimistic.problem}</span>
          <Button onClick={optimistic.dismissProblem}>Dismiss</Button>
        </div>
      )}
      {chosen.size > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-evidence-border bg-[#f7f5ee] px-4 py-3 text-[13px]"
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
        state={optimistic.view}
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
          onDelete={deleteOpenDocument}
          onReprocess={optimistic.reprocess}
          statusGuess={optimistic.statusGuesses.get(selectedId)}
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
