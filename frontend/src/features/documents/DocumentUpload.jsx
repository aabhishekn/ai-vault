import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { displayTitle } from '../../lib/format'
import { useUploadDocument } from './useUploadDocument'
import { UPLOAD_ACCEPT, validateUpload } from './upload'

// `handlers` ({ onStarted, onUploaded, onFailed }) let the list show the upload at once.
export function DocumentUpload({ handlers }) {
  const [file, setFile] = useState(null)
  const input = useRef(null)
  const { state, upload, reset } = useUploadDocument(handlers)
  const uploading = state.status === 'uploading'
  const validationError = file ? validateUpload(file) : null

  async function submit(event) {
    event.preventDefault()
    if (!file || validationError || uploading) return
    if (await upload(file)) {
      setFile(null)
      if (input.current) input.current.value = ''
    }
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
        className=""
        onSubmit={(event) => void submit(event)}
        aria-busy={uploading}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="document-file">
            Document file
          </label>
          <input
            className="min-w-0 flex-1 text-xs text-[#4a4943] file:mr-3 file:cursor-pointer file:rounded-[7px] file:border file:border-[#d6d2c4] file:bg-surface file:px-3 file:py-2.5 file:text-inherit file:[font:inherit]"
            ref={input}
            id="document-file"
            type="file"
            accept={UPLOAD_ACCEPT}
            required
            disabled={uploading}
            aria-describedby={`upload-help${validationError ? ' upload-validation' : ''}`}
            aria-invalid={Boolean(validationError)}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null)
              reset()
            }}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!file || Boolean(validationError) || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted" id="upload-help">
          PDF, PNG or JPG, up to 10 MB. Scans and photos are read by your
          configured AI provider.
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
