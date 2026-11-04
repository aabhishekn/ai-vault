import { useState } from 'react'
import { DocumentDetails } from './DocumentDetails'
import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { useDocuments } from './useDocuments'

export function DocumentWorkspace() {
  const documents = useDocuments()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <>
      <DocumentUpload onUploaded={() => documents.goToPage(0)} />
      <DocumentList {...documents} onSelect={setSelectedId} />
      {selectedId && (
        <DocumentDetails
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
