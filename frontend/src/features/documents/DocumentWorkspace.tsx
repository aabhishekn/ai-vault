import { DocumentList } from './DocumentList'
import { DocumentUpload } from './DocumentUpload'
import { useDocuments } from './useDocuments'

export function DocumentWorkspace() {
  const documents = useDocuments()
  return (
    <>
      <DocumentUpload onUploaded={() => documents.goToPage(0)} />
      <DocumentList {...documents} />
    </>
  )
}
