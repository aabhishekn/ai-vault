import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../../lib/api'
import { deleteDocument, renameDocument, reprocessDocument } from '../manage'
import {
  NO_OVERLAY,
  applyOverlay,
  pendingUpload,
  withAddedDocument,
  withReplacedDocument,
  withoutDocument,
} from './optimistic'

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Makes upload, delete and "process again" feel instant. Each one shows its result
 * straight away, sends the request, then either writes the confirmed result into the list
 * or puts everything back and says why. `view` is the list state to display.
 *
 * `openId` is a ref to the id of the document whose dialog is open: a refusal is reported
 * in the dialog while it is open, and in `problem` once it is not.
 */
export function useOptimisticDocuments(documents, openId) {
  const [overlay, setOverlay] = useState(NO_OVERLAY)
  const [problem, setProblem] = useState(null)
  // Requests finish later than the render that started them; read the list as it is then.
  const latest = useRef(documents)
  useEffect(() => {
    latest.current = documents
  })

  const filtered = Boolean(documents.search)
  const view = useMemo(
    () =>
      documents.state.status === 'success'
        ? {
            status: 'success',
            page: applyOverlay(documents.state.page, overlay, filtered),
          }
        : documents.state,
    [documents.state, overlay, filtered],
  )

  function setHidden(id, hidden) {
    setOverlay((previous) => {
      const next = new Set(previous.hidden)
      if (hidden) next.add(id)
      else next.delete(id)
      return { ...previous, hidden: next }
    })
  }

  function setStatusGuess(id, guess) {
    setOverlay((previous) => {
      const next = new Map(previous.statuses)
      if (guess) next.set(id, guess)
      else next.delete(id)
      return { ...previous, statuses: next }
    })
  }

  // `undefined` takes the guess away; null is a real guess: "show the file name".
  function setTitleGuess(id, title) {
    setOverlay((previous) => {
      const next = new Map(previous.titles)
      if (title === undefined) next.delete(id)
      else next.set(id, title)
      return { ...previous, titles: next }
    })
  }

  function setUploading(uploading) {
    setOverlay((previous) => ({ ...previous, uploading }))
  }

  const upload = {
    onStarted: (file) => setUploading(pendingUpload(file)),
    onFailed: () => setUploading(null),
    onUploaded(document) {
      setUploading(null)
      const { state, search, changePage, refreshQuietly, goToPage } =
        latest.current
      if (state.status === 'success' && state.page.offset === 0 && !search) {
        changePage((page) => withAddedDocument(page, document))
        refreshQuietly()
      } else {
        goToPage(0)
      }
    },
  }

  // Resolves when the document is gone, or after putting it back and reporting why.
  async function removeDocument(id, filename) {
    setProblem(null)
    setHidden(id, true)
    try {
      await deleteDocument(id, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      latest.current.changePage((page) => withoutDocument(page, id))
    } catch (error) {
      setProblem(
        `“${filename}” was not deleted. ${error instanceof ApiError ? error.message : 'Try again.'}`,
      )
    } finally {
      setHidden(id, false)
      latest.current.refreshQuietly()
    }
  }

  // Resolves with the queued document. On refusal it puts the status back and rethrows,
  // for the dialog to show; if the dialog was closed meanwhile the page says it instead.
  async function reprocess(id, from, filename) {
    setProblem(null)
    setStatusGuess(id, { from, to: 'queued' })
    try {
      const document = await reprocessDocument(
        id,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      )
      latest.current.changePage((page) => withReplacedDocument(page, document))
      return document
    } catch (error) {
      if (openId.current !== id)
        setProblem(
          `“${filename}” was not queued. ${error instanceof ApiError ? error.message : 'Try again.'}`,
        )
      throw error
    } finally {
      setStatusGuess(id, null)
      latest.current.refreshQuietly()
    }
  }

  // Resolves with the renamed document. On refusal it puts the old title back and rethrows,
  // for the dialog to show; if the dialog was closed meanwhile the page says it instead.
  async function rename(id, title, previousName) {
    setProblem(null)
    setTitleGuess(id, title.trim() || null)
    try {
      const document = await renameDocument(
        id,
        title,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      )
      latest.current.changePage((page) => withReplacedDocument(page, document))
      return document
    } catch (error) {
      if (openId.current !== id)
        setProblem(
          `“${previousName}” was not renamed. ${error instanceof ApiError ? error.message : 'Try again.'}`,
        )
      throw error
    } finally {
      setTitleGuess(id, undefined)
      latest.current.refreshQuietly()
    }
  }

  return {
    view,
    statusGuesses: overlay.statuses,
    titleGuesses: overlay.titles,
    problem,
    dismissProblem: () => setProblem(null),
    upload,
    removeDocument,
    reprocess,
    rename,
  }
}
