import { useState } from 'react'
import { Button } from '../../components/Button'
import { ComparisonDialog } from './ComparisonDialog'
import { MAX_COMPARED } from './comparison'
import { DocumentDetails } from './DocumentDetails'
import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { MultiDocumentChat } from './MultiDocumentChat'
import type { VaultDocument } from './types'
import { useDocuments } from './useDocuments'

const MAX_CHOSEN = 10

export function DocumentWorkspace() {
  const documents = useDocuments()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Documents chosen for a question across several (id -> filename).
  const [chosen, setChosen] = useState<Map<string, string>>(new Map())
  const [asking, setAsking] = useState(false)
  const [comparing, setComparing] = useState(false)

  function choose(document: VaultDocument) {
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
          <span className="flex gap-2">
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
      <DocumentList
        {...documents}
        onSelect={setSelectedId}
        chosen={chosen}
        onChoose={choose}
      />
      {selectedId && (
        <DocumentDetails
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onOpen={setSelectedId}
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
