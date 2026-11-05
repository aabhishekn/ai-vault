import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { displayTitle, formatFileSize } from '../../lib/format'
import { useUploadDocument } from './useUploadDocument'
import { UPLOAD_ACCEPT, validateUpload } from './upload'

// `handlers` ({ onStarted, onUploaded, onFailed }) let the list show the upload at once.
// A file is chosen by clicking the drop zone or dropping onto it, shown as a card with its
// name and size, and sent with the Upload button.
export function DocumentUpload({ handlers }) {
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef(null)
  const { state, upload, reset } = useUploadDocument(handlers)
  const uploading = state.status === 'uploading'
  const validationError = file ? validateUpload(file) : null

  function choose(next) {
    setFile(next)
    reset()
  }

  function clear() {
    setFile(null)
    if (input.current) input.current.value = ''
    reset()
  }

  function drop(event) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped && !uploading) choose(dropped)
  }

  async function submit(event) {
    event.preventDefault()
    if (!file || validationError || uploading) return
    if (await upload(file)) clear()
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
        <input
          ref={input}
          className="peer sr-only"
          id="document-file"
          aria-label="Document file"
          type="file"
          accept={UPLOAD_ACCEPT}
          tabIndex={file ? -1 : 0}
          disabled={uploading}
          aria-describedby={`upload-types upload-ai${validationError ? ' upload-validation' : ''}`}
          aria-invalid={Boolean(validationError)}
          onChange={(event) => choose(event.currentTarget.files?.[0] ?? null)}
        />
        {file ? (
          <div
            className={`grid grid-cols-1 gap-3 rounded-xl border bg-surface p-3 ${validationError ? 'border-[#e6c9c3]' : 'border-panel-border'}`}
          >
            <div className="flex items-center gap-3">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#f3e3d9] text-earth"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path
                    d="M5.5 2.5h6l3.5 3.5v11a1 1 0 01-1 1h-8.5a1 1 0 01-1-1v-13.5a1 1 0 011-1zM11.5 2.5V6H15"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {file.name}
                </span>
                <span className="block text-xs text-muted">
                  {formatFileSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-[#efede4] hover:text-ink disabled:cursor-default disabled:opacity-40"
                aria-label={`Remove ${file.name}`}
                title="Remove file"
                disabled={uploading}
                onClick={clear}
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={Boolean(validationError) || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        ) : (
          <label
            htmlFor="document-file"
            className={`flex cursor-pointer items-center gap-3.5 rounded-xl border border-dashed px-4 py-3.5 transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus motion-reduce:transition-none ${dragging ? 'border-brand bg-[#fbeee6]' : 'border-[#cfcab9] bg-surface hover:border-brand hover:bg-[#fffaf6]'}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setDragging(false)
            }}
            onDrop={drop}
          >
            <span
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f3e3d9] text-brand"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 20 20"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path
                  d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M3.5 13.5v1.5a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">
                Choose a file{' '}
                <span className="font-normal text-muted">or drag it here</span>
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {dragging
                  ? 'Drop to select it'
                  : 'PDF, PNG or JPG, up to 10 MB'}
              </span>
            </span>
          </label>
        )}
        <p className="mt-2 text-[11px] leading-[1.6] text-muted" id="upload-ai">
          Scans and photos are read by your configured AI provider.
        </p>
        <span className="sr-only" id="upload-types">
          PDF, PNG or JPG, up to 10 MB.
        </span>
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
