import { useState } from 'react'
import { Button } from '../../components/Button'
import { displayTitle } from '../../lib/format'
import { FilePicker } from './FilePicker'
import { useUploadDocument } from './useUploadDocument'
import { validateUpload } from './upload'

// `handlers` ({ onStarted, onUploaded, onFailed }) let the list show the upload at once.
// A file is chosen by clicking the drop zone or dropping onto it, shown as a card with its
// name and size, and sent with the Upload button.
export function DocumentUpload({ handlers }) {
  const [file, setFile] = useState(null)
  const { state, upload, reset } = useUploadDocument(handlers)
  const uploading = state.status === 'uploading'
  const validationError = file ? validateUpload(file) : null

  function choose(next) {
    setFile(next)
    reset()
  }

  async function submit(event) {
    event.preventDefault()
    if (!file || validationError || uploading) return
    if (await upload(file)) setFile(null)
  }

  return (
    <section
      className="shrink-0 border-b border-rule bg-[#f6f4ec] p-4"
      aria-labelledby="upload-heading"
    >
      <h2 className="sr-only" id="upload-heading">
        Add a document
      </h2>
      <form
        onSubmit={(event) => void submit(event)}
        aria-busy={uploading}
        noValidate
      >
        <FilePicker
          id="document-file"
          label="Document file"
          file={file}
          onChange={choose}
          disabled={uploading}
          invalid={Boolean(validationError)}
          describedBy={`upload-ai${validationError ? ' upload-validation' : ''}`}
        >
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={Boolean(validationError) || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </FilePicker>
        <p className="mt-2 text-[11px] leading-[1.6] text-muted" id="upload-ai">
          Scans and photos are read by your configured AI provider.
        </p>
        {validationError && (
          <p
            className="mt-2 text-xs leading-[1.8] wrap-anywhere text-error"
            id="upload-validation"
            role="alert"
          >
            {validationError}
          </p>
        )}
        {state.status === 'error' && (
          <p
            className="mt-2 text-xs leading-[1.8] wrap-anywhere text-error"
            role="alert"
          >
            {state.message}
          </p>
        )}
        {state.status === 'success' && (
          <p
            className="mt-2 text-xs leading-[1.8] wrap-anywhere text-[#375b3f]"
            role="status"
          >
            Uploaded “{displayTitle(state.document)}”. It will be ready once
            processing finishes.
          </p>
        )}
      </form>
    </section>
  )
}
