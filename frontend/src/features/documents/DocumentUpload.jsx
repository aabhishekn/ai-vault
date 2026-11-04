import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { displayTitle, formatFileSize } from '../../lib/format'
import { useUploadDocument } from './useUploadDocument'
import { validateUpload } from './upload'

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
      className="mb-6 rounded-[18px] border border-[#e1ddcf] bg-[#f3f1e9] p-[26px] max-[600px]:px-[18px] max-[600px]:py-[22px]"
      aria-labelledby="upload-heading"
    >
      <div>
        <p className="mb-3 text-[10px] font-[650] tracking-[1.6px] text-[#9a4a2c]">
          ADD TO YOUR VAULT
        </p>
        <h2
          className="mb-2.5 font-serif text-2xl font-normal tracking-[-0.5px]"
          id="upload-heading"
        >
          Add a document
        </h2>
        <p
          className="mb-[22px] text-[13px] leading-[1.7] text-muted"
          id="upload-help"
        >
          Choose a PDF up to 10 MB. We’ll save it and queue it for processing.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} aria-busy={uploading}>
        <div className="flex items-end gap-4 max-[600px]:flex-col max-[600px]:items-stretch">
          <div className="min-w-0 flex-1">
            <label
              className="mb-2 block text-xs font-semibold"
              htmlFor="document-file"
            >
              PDF document
            </label>
            <input
              className="w-full text-xs text-[#4a4943] file:mr-3 file:cursor-pointer file:rounded-[7px] file:border file:border-[#d6d2c4] file:bg-surface file:px-3 file:py-2.5 file:text-inherit file:[font:inherit]"
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
            variant="primary"
            className="max-[600px]:self-start"
            disabled={!file || Boolean(validationError) || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload PDF'}
          </Button>
        </div>
        {file && (
          <p className="mt-3.5 text-xs leading-[1.8] wrap-anywhere text-muted">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
        {validationError && (
          <p
            className="mt-3.5 text-xs leading-[1.8] wrap-anywhere text-error"
            id="upload-validation"
            role="alert"
          >
            {validationError}
          </p>
        )}
        {state.status === 'uploading' && (
          <p
            className="mt-3.5 text-xs leading-[1.8] wrap-anywhere text-[#375b3f]"
            role="status"
          >
            Uploading your PDF. Keep this page open until it finishes.
          </p>
        )}
        {state.status === 'error' && (
          <p
            className="mt-3.5 text-xs leading-[1.8] wrap-anywhere text-error"
            role="alert"
          >
            {state.message}
          </p>
        )}
        {state.status === 'success' && (
          <p
            className="mt-3.5 text-xs leading-[1.8] wrap-anywhere text-[#375b3f]"
            role="status"
          >
            “{displayTitle(state.document)}” was saved and queued for
            processing. It’s now in your document list.
          </p>
        )}
      </form>
    </section>
  )
}
