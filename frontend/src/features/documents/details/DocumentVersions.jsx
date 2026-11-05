import { useState } from 'react'
import { Button } from '../../../components/Button'
import { useResource } from '../../../lib/useResource'
import {
  displayTitle,
  formatFileSize,
  formatUploadDate,
} from '../../../lib/format'
import { ApiError } from '../../../lib/api'
import { FilePicker } from '../upload/FilePicker'
import { STATUS_LABELS } from '../status'
import { uploadNewVersion, validateUpload } from '../upload/upload'
import { getVersions } from './versions'

const LOAD_ERROR = 'We couldn’t load the versions. Try again.'

export function DocumentVersions({ id, onOpen, onVersionAdded }) {
  const { state, refresh } = useResource(id, getVersions, LOAD_ERROR)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const validationError = file ? validateUpload(file) : null

  function choose(next) {
    setFile(next)
    setError(null)
  }

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
      <div className="mb-4 flex items-center gap-2.5">
        <h3 id="versions-heading" className="text-[15px] font-semibold">
          Versions
        </h3>
        {state.status === 'success' && state.data.length > 1 && (
          <span
            className="grid h-6 min-w-6 place-items-center rounded-[7px] bg-[#f0eee6] px-[7px] text-[11px] text-[#5f5e57]"
            aria-label={`${state.data.length} versions`}
          >
            {state.data.length}
          </span>
        )}
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
          {state.data.map((version) => {
            const current = version.id === id
            return (
              <li
                key={version.id}
                className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 ${current ? 'border-[#e8cdbd] bg-[#fffaf6]' : 'border-panel-border bg-surface'}`}
              >
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 grid h-6 min-w-8 shrink-0 place-items-center rounded-md bg-[#f3e3d9] px-1.5 text-[11px] font-bold text-earth">
                    v{version.version_number}
                  </span>
                  <span className="min-w-0 wrap-anywhere">
                    <span className="block text-[13px] leading-[1.5] font-semibold">
                      {displayTitle(version)}
                      {version.is_latest && (
                        <span className="ml-2 inline-block rounded-full bg-success-soft px-2 py-0.5 align-middle text-[10px] leading-[1.4] font-semibold text-success">
                          Latest
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {formatFileSize(version.size_bytes)} ·{' '}
                      {formatUploadDate(version.created_at)} ·{' '}
                      {STATUS_LABELS[version.status] ?? version.status}
                    </span>
                  </span>
                </span>
                {current ? (
                  <span className="rounded-full bg-[#f3e3d9] px-2.5 py-1 text-[11px] font-semibold text-earth">
                    Viewing
                  </span>
                ) : (
                  <Button onClick={() => onOpen(version.id)}>
                    Open v{version.version_number}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold">Upload a new version</p>
        <FilePicker
          id="version-file"
          label="Upload a new version"
          file={file}
          onChange={choose}
          disabled={busy}
          invalid={Boolean(validationError)}
          describedBy={`version-help${(validationError ?? error) ? ' version-error' : ''}`}
        >
          <Button
            variant="primary"
            className="w-full"
            onClick={() => void submit()}
            disabled={Boolean(validationError) || busy}
          >
            {busy ? 'Uploading…' : 'Upload version'}
          </Button>
        </FilePicker>
        <p className="mt-2 text-xs leading-[1.8] text-muted" id="version-help">
          The new file is processed on its own; earlier versions stay available.
        </p>
        {(validationError ?? error) && (
          <p
            className="mt-2 text-[13px] text-error"
            id="version-error"
            role="alert"
          >
            {validationError ?? error}
          </p>
        )}
      </div>
    </section>
  )
}
