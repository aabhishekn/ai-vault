import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { useResource } from '../../hooks/useResource'
import {
  displayTitle,
  formatFileSize,
  formatUploadDate,
} from '../../lib/format'
import { ApiError } from '../../lib/api'
import { UPLOAD_ACCEPT, uploadNewVersion, validateUpload } from './upload'
import { getVersions } from './versions'

const LOAD_ERROR = 'We couldn’t load the versions. Try again.'

export function DocumentVersions({ id, onOpen, onVersionAdded }) {
  const { state, refresh } = useResource(id, getVersions, LOAD_ERROR)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  const validationError = file ? validateUpload(file) : null

  async function submit() {
    if (!file || validationError || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await uploadNewVersion(
        id,
        file,
        AbortSignal.timeout(60_000),
      )
      setFile(null)
      if (input.current) input.current.value = ''
      onVersionAdded(created.id)
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The upload failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="border-t border-rule py-6"
      aria-labelledby="versions-heading"
    >
      <div className="mb-4">
        <h3 id="versions-heading" className="text-[15px] font-semibold">
          Versions
        </h3>
      </div>
      {state.status === 'loading' && (
        <p className="text-[13px] text-muted" role="status">
          Loading versions…
        </p>
      )}
      {state.status === 'error' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-error" role="alert">
            {state.message}
          </p>
          <Button onClick={refresh}>Try again</Button>
        </div>
      )}
      {/* A list of one is only the document already on screen. */}
      {state.status === 'success' && state.data.length > 1 && (
        <ul className="grid list-none gap-2" aria-label="Document versions">
          {state.data.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-panel-border px-3 py-2 text-[13px]"
            >
              <span className="min-w-0 wrap-anywhere">
                <strong>v{version.version_number}</strong>
                {version.is_latest ? ' · latest' : ''} · {displayTitle(version)}
                <span className="block text-[11px] text-muted">
                  {formatFileSize(version.size_bytes)} ·{' '}
                  {formatUploadDate(version.created_at)} · {version.status}
                </span>
              </span>
              {version.id === id ? (
                <span className="text-[11px] text-muted">Viewing</span>
              ) : (
                <Button onClick={() => onOpen(version.id)}>
                  Open v{version.version_number}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5">
        <label
          htmlFor="version-file"
          className="mb-2 block text-xs font-semibold"
        >
          Upload a new version
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            id="version-file"
            type="file"
            accept={UPLOAD_ACCEPT}
            disabled={busy}
            className="min-w-0 flex-1 text-xs"
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null)
              setError(null)
            }}
          />
          <Button
            onClick={() => void submit()}
            disabled={!file || Boolean(validationError) || busy}
          >
            {busy ? 'Uploading…' : 'Upload version'}
          </Button>
        </div>
        <p className="mt-2 text-xs leading-[1.8] text-muted">
          The new file is processed on its own; earlier versions stay available.
        </p>
        {(validationError ?? error) && (
          <p className="mt-2 text-[13px] text-error" role="alert">
            {validationError ?? error}
          </p>
        )}
      </div>
    </section>
  )
}
