import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { formatFileSize } from '../../lib/format'
import { useUploadDocument } from './useUploadDocument'
import { validateUpload } from './upload'
import './DocumentUpload.css'

export function DocumentUpload({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { state, upload, reset } = useUploadDocument(onUploaded)
  const uploading = state.status === 'uploading'
  const validationError = file ? validateUpload(file) : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || validationError || uploading) return
    if (await upload(file)) {
      setFile(null)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section className="document-upload" aria-labelledby="upload-heading">
      <div>
        <p className="upload-eyebrow">ADD TO YOUR VAULT</p>
        <h2 id="upload-heading">A new document. A new possibility.</h2>
        <p id="upload-help">
          Choose a PDF up to 10 MB. We’ll save it and queue it for processing.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} aria-busy={uploading}>
        <div className="upload-controls">
          <div className="upload-file-field">
            <label htmlFor="document-file">PDF document</label>
            <input
              ref={input}
              id="document-file"
              type="file"
              accept=".pdf,application/pdf"
              required
              disabled={uploading}
              aria-describedby={`upload-help${validationError ? ' upload-validation' : ''}`}
              aria-invalid={Boolean(validationError)}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null)
                reset()
              }}
            />
          </div>
          <Button
            type="submit"
            className="upload-submit"
            disabled={!file || Boolean(validationError) || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload PDF'}
          </Button>
        </div>
        {file && (
          <p className="upload-selected">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
        {validationError && (
          <p className="upload-error" id="upload-validation" role="alert">
            {validationError}
          </p>
        )}
        {state.status === 'uploading' && (
          <p className="upload-feedback" role="status">
            Uploading your PDF. Keep this page open until it finishes.
          </p>
        )}
        {state.status === 'error' && (
          <p className="upload-error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === 'success' && (
          <p className="upload-feedback" role="status">
            “{state.document.filename}” was saved and queued for processing.
            It’s now in your document list.
          </p>
        )}
      </form>
    </section>
  )
}
