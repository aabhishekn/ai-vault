// @vitest-environment jsdom
import { createElement } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentWorkspace } from './DocumentWorkspace'

afterEach(cleanup)

class IdleSocket {
  close() {}
}

function documentNamed(id, status = 'embedded') {
  return {
    id,
    filename: `${id}.pdf`,
    content_type: 'application/pdf',
    size_bytes: 1000,
    status,
    created_at: '2026-11-04T06:00:00Z',
  }
}

const RUNNING = { status: 'ok', redis: 'connected', workers: 1, queued_jobs: 0 }

function serve(items, queue = RUNNING) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url)
      if (path.includes('/health/queue'))
        return Promise.resolve(
          queue ? Response.json(queue) : new Response('down', { status: 503 }),
        )
      return Promise.resolve(
        path.includes('/documents')
          ? Response.json({ items, total: items.length, limit: 10, offset: 0 })
          : Response.json({ categories: [], tags: [] }),
      )
    }),
  )
}

describe('selecting documents', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  it('shows a selection bar once a document is chosen', async () => {
    serve([documentNamed('a'), documentNamed('b')])
    render(createElement(DocumentWorkspace))
    await screen.findByText('a')
    expect(screen.queryByText(/selected/)).toBeNull()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()
  })

  it('only offers Select on documents that can be asked about', async () => {
    serve([documentNamed('a'), documentNamed('b', 'queued')])
    render(createElement(DocumentWorkspace))
    await screen.findByText('a')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })
})

describe('background worker notice', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  const notice = /background processing is not running/i

  it('warns that uploads will stay queued when no worker is running', async () => {
    serve([documentNamed('a')], {
      status: 'no_workers',
      redis: 'connected',
      workers: 0,
      queued_jobs: 2,
    })
    render(createElement(DocumentWorkspace))
    const warning = await screen.findByText(notice)
    expect(warning.textContent).toMatch(/new uploads will wait in the queue/)
    // No shell commands on screen: those live in the README.
    expect(warning.textContent).not.toMatch(/python/)
  })

  it('stays quiet when a worker is running', async () => {
    serve([documentNamed('a')])
    render(createElement(DocumentWorkspace))
    await screen.findByText('a')
    expect(screen.queryByText(notice)).toBeNull()
  })

  it('never warns when the check itself fails', async () => {
    serve([documentNamed('a')], null)
    render(createElement(DocumentWorkspace))
    await screen.findByText('a')
    expect(screen.queryByText(notice)).toBeNull()
  })
})

// Upload, delete and "process again" show their result before the server answers, and put
// everything back if it refuses. These tests hold the server's answer back to look at the
// screen in between.
describe('optimistic changes', () => {
  const dialog = HTMLDialogElement.prototype
  const original = { showModal: dialog.showModal, close: dialog.close }

  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
    // jsdom has no modal dialogs; an open attribute is enough to make one visible.
    dialog.showModal = function showModal() {
      this.setAttribute('open', '')
    }
    dialog.close = function close() {
      this.removeAttribute('open')
    }
  })
  afterEach(() => {
    // Unmount first: closing a dialog needs the stand-ins above.
    cleanup()
    dialog.showModal = original.showModal
    dialog.close = original.close
  })

  function deferred() {
    const gate = {}
    gate.promise = new Promise((resolve) => {
      gate.resolve = resolve
    })
    return gate
  }

  // A stand-in server whose list reflects `items`; mutating the array changes what the
  // next fetch returns, and each action's answer is whatever its handler returns.
  function serveVault(items, handlers) {
    const fetch = vi.fn((url, options = {}) => {
      const path = String(url)
      const method = options.method ?? 'GET'
      if (path.includes('/health/queue'))
        return Promise.resolve(Response.json(RUNNING))
      if (method === 'DELETE') return handlers.onDelete()
      if (method === 'PATCH') return handlers.onRename()
      if (method === 'POST' && path.includes('/reprocess'))
        return handlers.onReprocess()
      if (method === 'POST' && /\/documents(\?|$)/.test(path))
        return handlers.onUpload()
      const one = path.match(/\/documents\/([^/?]+)$/)
      if (one) {
        const found = items.find((item) => item.id === one[1])
        return Promise.resolve(
          found ? Response.json(found) : new Response('x', { status: 404 }),
        )
      }
      if (/\/documents(\?|$)/.test(path))
        return Promise.resolve(
          Response.json({
            items: [...items],
            total: items.length,
            limit: 10,
            offset: 0,
          }),
        )
      return Promise.resolve(Response.json({ categories: [], tags: [] }))
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  async function openDocument(name) {
    fireEvent.click(await screen.findByRole('button', { name }))
    await screen.findByText('Document details')
  }

  const refusal = (status) => Response.json({ detail: 'no' }, { status })

  // Sibling components in the dialog once shared one key, which React warns about
  // (and may answer by dropping or duplicating one of them).
  it('opens a document without duplicate-key warnings', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    serveVault([documentNamed('a')], {})
    render(createElement(DocumentWorkspace))
    await openDocument('a')
    expect(
      error.mock.calls.filter(([message]) => /same key/.test(String(message))),
    ).toEqual([])
  })

  describe('delete', () => {
    it('removes the row as soon as it is confirmed', async () => {
      const items = [documentNamed('a'), documentNamed('b')]
      const gate = deferred()
      const fetch = serveVault(items, { onDelete: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')

      fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete permanently' }),
      )

      // The server has not answered, yet the row and the dialog are gone.
      expect(screen.queryByRole('button', { name: 'a' })).toBeNull()
      expect(screen.queryByText('Document details')).toBeNull()
      expect(screen.getByRole('button', { name: 'b' })).toBeTruthy()
      expect(screen.getByLabelText('1 documents')).toBeTruthy()

      items.shift()
      gate.resolve(new Response(null, { status: 204 }))
      await waitFor(() => {
        const deletes = fetch.mock.calls.filter(
          ([, options]) => options?.method === 'DELETE',
        )
        expect(deletes).toHaveLength(1)
      })
      await waitFor(() =>
        expect(screen.queryByText(/was not deleted/)).toBeNull(),
      )
      expect(screen.queryByRole('button', { name: 'a' })).toBeNull()
    })

    it('brings the row back and says why when the server refuses', async () => {
      const gate = deferred()
      serveVault([documentNamed('a'), documentNamed('b')], {
        onDelete: () => gate.promise,
      })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete permanently' }),
      )
      expect(screen.queryByRole('button', { name: 'a' })).toBeNull()

      gate.resolve(refusal(409))

      expect((await screen.findByText(/was not deleted/)).textContent).toMatch(
        /“a” was not deleted\. This document is still being processed/,
      )
      expect(screen.getByRole('button', { name: 'a' })).toBeTruthy()
      expect(screen.getByLabelText('2 documents')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(screen.queryByText(/was not deleted/)).toBeNull()
    })
  })

  describe('process again', () => {
    const failed = () => documentNamed('a', 'failed')

    it('shows the document as queued in the list and the dialog at once', async () => {
      const items = [failed()]
      const gate = deferred()
      serveVault(items, { onReprocess: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(screen.getAllByText('Failed')).toHaveLength(2)

      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))

      expect(screen.getAllByText('Queued')).toHaveLength(2)
      expect(screen.queryByText('Failed')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Process again' })).toBeNull()
      expect(screen.getByText(/Queued for processing/)).toBeTruthy()

      items[0] = documentNamed('a', 'queued')
      gate.resolve(Response.json(items[0]))
      await waitFor(() =>
        expect(screen.queryByText(/Queued for processing/)).toBeTruthy(),
      )
      // Confirmed, so it stays queued rather than flickering back to failed.
      expect(screen.getAllByText('Queued')).toHaveLength(2)
      expect(screen.queryByText('Failed')).toBeNull()
    })

    it('goes back to failed and explains when queueing is refused', async () => {
      const gate = deferred()
      serveVault([failed()], { onReprocess: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
      expect(screen.getAllByText('Queued')).toHaveLength(2)

      gate.resolve(refusal(503))

      expect(await screen.findByText(/queue is unavailable/)).toBeTruthy()
      expect(screen.getAllByText('Failed')).toHaveLength(2)
      expect(screen.queryByText('Queued')).toBeNull()
      expect(screen.getByRole('button', { name: 'Process again' })).toBeTruthy()
    })

    it('reports a refusal on the page when the dialog was closed meanwhile', async () => {
      const gate = deferred()
      serveVault([failed()], { onReprocess: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      gate.resolve(refusal(503))

      expect((await screen.findByText(/was not queued/)).textContent).toMatch(
        /“a” was not queued\. The processing queue is unavailable/,
      )
      expect(screen.getByText('Failed')).toBeTruthy()
    })
  })

  describe('rename', () => {
    const rename = (value) => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
      const field = screen.getByLabelText('Title')
      fireEvent.change(field, { target: { value } })
      fireEvent.submit(field.closest('form'))
    }

    it('shows an AI-written title in the list and says so in the dialog', async () => {
      serveVault(
        [
          {
            ...documentNamed('a'),
            title: 'RAG Vault Design',
            title_source: 'ai',
          },
        ],
        {},
      )
      render(createElement(DocumentWorkspace))
      await openDocument('RAG Vault Design')
      expect(screen.getAllByText('RAG Vault Design')).toHaveLength(2)
      expect(screen.getByText(/written by AI/)).toBeTruthy()
      // The exact file name stays available.
      expect(screen.getAllByText('a.pdf').length).toBeGreaterThan(0)
    })

    it('shows the new title at once in the dialog and the list', async () => {
      const items = [documentNamed('a')]
      const gate = deferred()
      const fetch = serveVault(items, { onRename: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')

      rename('  Q3 Plan ')

      // The server has not answered, yet both places already read the new title.
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(2)
      expect(screen.getByText('Title set by you.')).toBeTruthy()

      items[0] = { ...items[0], title: 'Q3 Plan', title_source: 'user' }
      gate.resolve(Response.json(items[0]))
      await waitFor(() =>
        expect(screen.getByText('Title set by you.')).toBeTruthy(),
      )
      const patches = fetch.mock.calls.filter(
        ([, options]) => options?.method === 'PATCH',
      )
      expect(patches).toHaveLength(1)
      expect(JSON.parse(patches[0][1].body)).toEqual({ title: 'Q3 Plan' })
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(2)
    })

    it('puts the old title back and keeps the text when the server refuses', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onRename: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      rename('Q3 Plan')
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(2)

      gate.resolve(refusal(500))

      expect(await screen.findByText(/couldn’t save the title/)).toBeTruthy()
      expect(screen.getByLabelText('Title').value).toBe('Q3 Plan')
      // Behind the form the list has its old title back.
      expect(screen.getByRole('button', { name: 'a' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Q3 Plan' })).toBeNull()
    })

    it('shows the file name again after a blank title', async () => {
      const items = [
        { ...documentNamed('a'), title: 'Old Name', title_source: 'user' },
      ]
      const gate = deferred()
      const fetch = serveVault(items, { onRename: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('Old Name')

      rename('   ')

      // The list row and the dialog both read the file name again.
      expect(screen.getAllByRole('heading', { name: 'a' })).toHaveLength(2)
      expect(screen.getByText(/Showing the file name/)).toBeTruthy()
      items[0] = { ...documentNamed('a') }
      gate.resolve(Response.json(items[0]))
      await waitFor(() => {
        const [, options] = fetch.mock.calls.find(
          ([, options]) => options?.method === 'PATCH',
        )
        expect(JSON.parse(options.body)).toEqual({ title: null })
      })
    })

    it('reports a refusal on the page when the dialog was closed meanwhile', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onRename: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      rename('Q3 Plan')
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      gate.resolve(refusal(500))

      expect((await screen.findByText(/was not renamed/)).textContent).toMatch(
        /“a” was not renamed/,
      )
      expect(screen.getByRole('button', { name: 'a' })).toBeTruthy()
    })
  })

  describe('upload', () => {
    const pdf = () =>
      new File(['%PDF-1.4'], 'New.pdf', { type: 'application/pdf' })

    function choosePdf() {
      fireEvent.change(screen.getByLabelText('PDF document'), {
        target: { files: [pdf()] },
      })
      // Submit the form directly: jsdom would block a click on a required file input.
      fireEvent.submit(
        screen.getByRole('button', { name: 'Upload PDF' }).closest('form'),
      )
    }

    it('adds the file to the top of the list while it uploads', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onUpload: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await screen.findByText('a')

      choosePdf()

      const row = (await screen.findByText('New')).closest('li')
      expect(row.textContent).toMatch(/Uploading/)
      expect(row.getAttribute('aria-busy')).toBe('true')
      expect(screen.queryByRole('button', { name: 'New' })).toBeNull()
      expect(screen.getAllByRole('listitem')[0]).toBe(row)
      expect(screen.getByLabelText('2 documents')).toBeTruthy()
      gate.resolve(refusal(500))
      await screen.findByText(/couldn’t confirm the upload/)
    })

    it('swaps in the saved document without reloading the list', async () => {
      const items = [documentNamed('a')]
      const gate = deferred()
      serveVault(items, { onUpload: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await screen.findByText('a')
      choosePdf()
      await screen.findByText('New')

      const saved = { ...documentNamed('new', 'queued'), filename: 'New' }
      items.unshift(saved)
      gate.resolve(Response.json(saved, { status: 201 }))

      expect(await screen.findByRole('button', { name: 'New' })).toBeTruthy()
      expect(screen.queryByText('Uploading')).toBeNull()
      expect(screen.queryByText('Gathering your documents…')).toBeNull()
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(screen.getByLabelText('2 documents')).toBeTruthy()
    })

    it('takes the row away again when the upload fails', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onUpload: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await screen.findByText('a')
      choosePdf()
      await screen.findByText('New')

      gate.resolve(refusal(413))

      expect(await screen.findByText(/10 MB or smaller/)).toBeTruthy()
      await waitFor(() => expect(screen.queryByText('New')).toBeNull())
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByLabelText('1 documents')).toBeTruthy()
    })
  })
})
