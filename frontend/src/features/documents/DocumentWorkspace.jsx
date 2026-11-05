import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ChatPane } from './chat/ChatPane'
import { ComparisonDialog } from './compare/ComparisonDialog'
import { DocumentDetails } from './details/DocumentDetails'
import { DocumentList } from './list/DocumentList'
import { DocumentUpload } from './upload/DocumentUpload'

import { displayTitle } from '../../lib/format'
import { useDocuments } from './list/useDocuments'
import { useOptimisticDocuments } from './list/useOptimisticDocuments'
import { useQueueHealth } from '../health/useQueueHealth'
import { WorkerNotice } from '../health/WorkerNotice'
import { useLiveUpdates } from './list/useLiveUpdates'
import { chatScope, MAX_SCOPE } from './chat/scope'
import { useReadyDocuments } from './chat/useReadyDocuments'

export function DocumentWorkspace() {
  const documents = useDocuments()
  const queue = useQueueHealth()
  const [selectedId, setSelectedId] = useState(null)
  // Documents chosen for a question across several (id -> title).
  const [chosen, setChosen] = useState(new Map())
  // Which pane a narrow screen shows; null picks one from what the vault holds.
  const [view, setView] = useState(null)
  const [comparing, setComparing] = useState(false)
  // Change counters for the open document, so its details reload when it changes.
  const [pushed, setPushed] = useState({ id: '', revision: 0, content: 0 })
  // Counts every push, for what the open document shows about other documents (its versions).
  const [pushes, setPushes] = useState(0)
  const selected = useRef(selectedId)
  useEffect(() => {
    selected.current = selectedId
  }, [selectedId])
  // Drops documents that no longer exist from the chat's scope.
  function forget(ids) {
    setChosen((previous) => {
      if (![...ids].some((id) => previous.has(id))) return previous
      const next = new Map(previous)
      for (const id of ids) next.delete(id)
      return next
    })
  }
  useLiveUpdates((changed) => {
    documents.refreshQuietly()
    setPushes((previous) => previous + 1)
    // A document deleted elsewhere (another tab, the API) must not stay in the chat's scope.
    if (changed?.deleted.size) forget(changed.deleted)
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
  // What the chat asks about: the ticked documents, else everything that is ready.
  // Read from what is on screen, so a rename or delete shows in the chat's scope at once.
  const library = useReadyDocuments(optimistic.view, Boolean(documents.search))
  const scope = chatScope(chosen, library.ready)
  const shown = view ?? (library.loaded && !library.anyReady ? 'docs' : 'chat')

  function choose(document) {
    setChosen((previous) => {
      const next = new Map(previous)
      if (next.has(document.id)) next.delete(document.id)
      else if (next.size < MAX_SCOPE)
        next.set(document.id, displayTitle(document))
      return next
    })
  }

  function untick(id) {
    setChosen((previous) => {
      const next = new Map(previous)
      next.delete(id)
      return next
    })
  }

  // From the details dialog: ask about just this document.
  function askAbout(id, name) {
    setChosen(new Map([[id, name]]))
    setSelectedId(null)
    setView('chat')
  }

  function deleteOpenDocument(id, name) {
    setChosen((previous) => {
      const next = new Map(previous)
      next.delete(id)
      return next
    })
    setSelectedId(null)
    void optimistic.removeDocument(id, name)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
      <div
        className="flex shrink-0 gap-2 border-b border-rule bg-surface px-4 py-2 lg:hidden"
        role="group"
        aria-label="Show"
      >
        {[
          ['chat', 'Chat'],
          ['docs', 'Documents'],
        ].map(([id, label]) => (
          <Button
            key={id}
            aria-pressed={shown === id}
            className={shown === id ? 'border-ink font-bold' : ''}
            onClick={() => setView(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <aside
        className={`min-h-0 flex-col border-rule bg-surface lg:flex lg:border-r ${shown === 'docs' ? 'flex' : 'hidden'}`}
        aria-label="Library"
      >
        <DocumentUpload handlers={optimistic.upload} />
        <WorkerNotice health={queue} />
        {optimistic.problem && (
          <div
            className="m-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#e6c9c3] bg-[#fffaf7] px-4 py-3 text-[13px] text-error"
            role="alert"
          >
            <span>{optimistic.problem}</span>
            <Button onClick={optimistic.dismissProblem}>Dismiss</Button>
          </div>
        )}
        <DocumentList
          {...documents}
          state={optimistic.view}
          onSelect={setSelectedId}
          chosen={chosen}
          onChoose={choose}
        />
      </aside>
      <ChatPane
        scope={scope}
        library={library}
        className={shown === 'chat' ? 'flex' : 'hidden lg:flex'}
        onUntick={untick}
        onUseAll={() => setChosen(new Map())}
        onCompare={() => setComparing(true)}
        onShowDocuments={() => setView('docs')}
      />
      {selectedId && (
        <DocumentDetails
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onOpen={setSelectedId}
          liveRevision={live.revision}
          contentRevision={live.content}
          versionsRevision={pushes}
          onAsk={askAbout}
          onDelete={deleteOpenDocument}
          onReprocess={optimistic.reprocess}
          onRename={optimistic.rename}
          titleGuess={optimistic.titleGuesses.get(selectedId)}
          statusGuess={optimistic.statusGuesses.get(selectedId)}
          onVersionAdded={(newId) => {
            documents.goToPage(0)
            setSelectedId(newId)
          }}
        />
      )}
      {comparing && (
        <ComparisonDialog
          key={scope.ids.join(',')}
          documents={new Map(scope.items.map((item) => [item.id, item.name]))}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  )
}
