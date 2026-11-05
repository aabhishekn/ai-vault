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
          : Response.json({}),
      )
    }),
  )
}

describe('selecting documents', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  const asking = () => screen.getByRole('group', { name: 'Asking' })

  it('asks every ready document until some are ticked, then only those', async () => {
    serve([documentNamed('a'), documentNamed('b'), documentNamed('c')])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    expect(asking().textContent).toContain('All documents (3)')
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about a' }))
    expect(asking().textContent).not.toContain('All documents')
    expect(
      screen.getByRole('button', { name: 'Stop asking about a' }),
    ).toBeTruthy()
    // One document is a conversation of its own, so there is nothing to compare.
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about b' }))
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop asking about b' }))
    expect(
      screen.queryByRole('button', { name: 'Stop asking about b' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use all documents' }))
    expect(asking().textContent).toContain('All documents (3)')
  })

  it('only offers a tick box on documents that can be asked about', async () => {
    serve([documentNamed('a'), documentNamed('b', 'queued')])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('invites an upload when the vault is empty', async () => {
    serve([])
    render(createElement(DocumentWorkspace))
    expect(
      await screen.findByText(/Upload a PDF or an image to start/),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('says documents are processing when none can be asked about yet', async () => {
    serve([documentNamed('a', 'queued'), documentNamed('b', 'processing')])
    render(createElement(DocumentWorkspace))
    expect(
      await screen.findByText(/2 documents are still being processed/),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('paging the list', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  it('has no page controls when every document fits on one page', async () => {
    serve([documentNamed('a')])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    expect(
      screen.queryByRole('navigation', { name: 'Document pages' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('offers Previous and Next once there is more than one page', async () => {
    const items = Array.from({ length: 10 }, (_, n) => documentNamed(`d${n}`))
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url)
        if (path.includes('/health/queue'))
          return Promise.resolve(Response.json(RUNNING))
        return Promise.resolve(
          path.includes('/documents')
            ? Response.json({ items, total: 25, limit: 10, offset: 0 })
            : Response.json({}),
        )
      }),
    )
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'd0' })
    expect(
      screen.getByRole('navigation', { name: 'Document pages' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Next' }).disabled).toBe(false)
    expect(screen.getByText(/Showing/).textContent).toContain('1–10 of 25')
  })
})

describe('searching the list', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  // A server that filters by file name, the way the real one filters by title and name.
  function serveSearchable(all) {
    const fetch = vi.fn((url) => {
      const path = String(url)
      if (path.includes('/health/queue'))
        return Promise.resolve(Response.json(RUNNING))
      if (!path.includes('/documents'))
        return Promise.resolve(Response.json({}))
      const q = new URL(path, 'http://x').searchParams.get('q')
      const items = q ? all.filter((item) => item.filename.includes(q)) : all
      return Promise.resolve(
        Response.json({ items, total: items.length, limit: 10, offset: 0 }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  const searches = (fetch) =>
    fetch.mock.calls
      .map(([url]) => new URL(String(url), 'http://x').searchParams.get('q'))
      .filter(Boolean)
  const box = () => screen.getByRole('searchbox', { name: 'Search documents' })
  const type = (text) => fireEvent.change(box(), { target: { value: text } })
  const SLOW = { timeout: 2000 }

  it('shows only the matches once typing pauses, and one request for the final words', async () => {
    const fetch = serveSearchable([
      documentNamed('a'),
      documentNamed('b'),
      documentNamed('c'),
    ])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    type('b')
    type('b.')
    expect(searches(fetch)).toEqual([])
    await waitFor(() => expect(searches(fetch)).toEqual(['b.']), SLOW)
    type('b')
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'a' })).toBeNull(),
      SLOW,
    )
    expect(screen.getByRole('button', { name: 'b' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'c' })).toBeNull()
    expect(screen.getByLabelText('1 documents')).toBeTruthy()
  })

  it('says nothing matches, and Clear search brings every document back', async () => {
    serveSearchable([documentNamed('a'), documentNamed('b')])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    type('zzz')
    expect(
      await screen.findByText('No documents match “zzz”.', {}, SLOW),
    ).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Clear search' }).at(-1),
    )
    expect(box().value).toBe('')
    expect(await screen.findByRole('button', { name: 'b' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'a' })).toBeTruthy()
  })

  it('clears the box with Escape and the clear button, and searches again straight away on Enter', async () => {
    const fetch = serveSearchable([documentNamed('a'), documentNamed('b')])
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    type('b')
    fireEvent.submit(box().closest('form'))
    expect(searches(fetch)).toEqual(['b'])
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box().value).toBe('')
    type('a')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box().value).toBe('')
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
    await screen.findByRole('button', { name: 'a' })
    expect(screen.queryByText(notice)).toBeNull()
  })

  it('never warns when the check itself fails', async () => {
    serve([documentNamed('a')], null)
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
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
      return Promise.resolve(Response.json({}))
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  async function openDocument(name) {
    fireEvent.click(await screen.findByRole('button', { name }))
    await screen.findByRole('tab', { name: 'Details' })
  }

  // Delete and Process again live under Details; a document that cannot be asked about
  // opens there, any other opens on Ask.
  function openDetails() {
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
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

      openDetails()
      fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete permanently' }),
      )

      // The server has not answered, yet the row and the dialog are gone.
      expect(screen.queryByRole('button', { name: 'a' })).toBeNull()
      expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull()
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
      openDetails()
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

      openDetails()
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
      openDetails()
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
      openDetails()
      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      gate.resolve(refusal(503))

      expect((await screen.findByText(/was not queued/)).textContent).toMatch(
        /“a” was not queued\. The processing queue is unavailable/,
      )
      expect(screen.getByText('Failed')).toBeTruthy()
    })
  })

  describe('dialog tabs', () => {
    const selected = () =>
      screen
        .getAllByRole('tab')
        .filter((tab) => tab.getAttribute('aria-selected') === 'true')
        .map((tab) => tab.textContent)

    it('opens on Summary for a document that can be asked about', async () => {
      serveVault([documentNamed('a', 'embedded')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(selected()).toEqual(['Summary'])
      expect(screen.getByRole('tabpanel', { name: 'Summary' })).toBeTruthy()
      // The other sections are not on screen until their tab is chosen.
      expect(
        screen.queryByRole('button', { name: /Delete document/ }),
      ).toBeNull()
    })

    it('says why a document failed, in the reason the server saved', async () => {
      const reason =
        'No readable text found, even when the pages were read as images.'
      serveVault(
        [{ ...documentNamed('a', 'failed'), error_message: reason }],
        {},
      )
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(screen.getByText(reason)).toBeTruthy()
    })

    it('opens on Details for a document that cannot be asked about yet', async () => {
      serveVault([documentNamed('a', 'failed')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(selected()).toEqual(['Details'])
      expect(
        screen.getByText('Processing failed. The file is still saved.'),
      ).toBeTruthy()
      expect(
        screen.getByRole('button', { name: /Delete document/ }),
      ).toBeTruthy()
      // Nothing to ask about yet, so there is no shortcut to the chat.
      expect(
        screen.queryByRole('button', { name: 'Ask about this document' }),
      ).toBeNull()
    })

    it('says nothing extra about a document that is ready to use', async () => {
      serveVault([documentNamed('a', 'embedded')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(
        screen.queryByText(/Processing failed|Waiting to be processed/),
      ).toBeNull()
    })

    it('moves between tabs with the arrow keys', async () => {
      serveVault([documentNamed('a')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), {
        key: 'ArrowRight',
      })
      expect(selected()).toEqual(['Details'])
      expect(globalThis.document.activeElement.textContent).toBe('Details')
      fireEvent.keyDown(globalThis.document.activeElement, { key: 'Home' })
      expect(selected()).toEqual(['Summary'])
      fireEvent.keyDown(globalThis.document.activeElement, { key: 'End' })
      expect(selected()).toEqual(['Details'])
      fireEvent.keyDown(globalThis.document.activeElement, {
        key: 'ArrowRight',
      })
      expect(selected()).toEqual(['Summary'])
    })

    it('points the chat at the document and closes the dialog', async () => {
      serveVault([documentNamed('a'), documentNamed('b')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      expect(
        screen.getByRole('group', { name: 'Asking' }).textContent,
      ).toContain('All documents (2)')

      fireEvent.click(
        screen.getByRole('button', { name: 'Ask about this document' }),
      )
      expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull()
      const asking = screen.getByRole('group', { name: 'Asking' })
      expect(asking.textContent).not.toContain('All documents')
      expect(
        screen.getByRole('button', { name: 'Stop asking about a' }),
      ).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: 'Stop asking about b' }),
      ).toBeNull()
    })

    it('goes back to the first tab for the next document', async () => {
      serveVault([documentNamed('a'), documentNamed('b')], {})
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      await openDocument('b')
      expect(selected()).toEqual(['Summary'])
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
      expect(screen.getAllByText('RAG Vault Design')).toHaveLength(3)
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
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(3)
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
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(3)
    })

    it('puts the old title back and keeps the text when the server refuses', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onRename: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await openDocument('a')
      rename('Q3 Plan')
      expect(screen.getAllByText('Q3 Plan')).toHaveLength(3)

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
      fireEvent.change(screen.getByLabelText('Document file'), {
        target: { files: [pdf()] },
      })
      // Submit the form directly: jsdom would block a click on a required file input.
      fireEvent.submit(
        screen.getByRole('button', { name: 'Upload' }).closest('form'),
      )
    }

    it('adds the file to the top of the list while it uploads', async () => {
      const gate = deferred()
      serveVault([documentNamed('a')], { onUpload: () => gate.promise })
      render(createElement(DocumentWorkspace))
      await screen.findByRole('button', { name: 'a' })

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
      await screen.findByRole('button', { name: 'a' })
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
      await screen.findByRole('button', { name: 'a' })
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

describe('live updates', () => {
  const dialog = HTMLDialogElement.prototype
  const original = { showModal: dialog.showModal, close: dialog.close }
  let sockets

  class FakeSocket {
    constructor() {
      sockets.push(this)
    }
    close() {}
  }

  beforeEach(() => {
    sockets = []
    vi.stubGlobal('WebSocket', FakeSocket)
    // jsdom has no modal dialogs; an open attribute is enough to make one visible.
    dialog.showModal = function showModal() {
      this.setAttribute('open', '')
    }
    dialog.close = function close() {
      this.removeAttribute('open')
    }
  })
  afterEach(() => {
    cleanup()
    dialog.showModal = original.showModal
    dialog.close = original.close
  })

  // What the server pushes over the socket the page opened.
  function push(event) {
    sockets.at(-1).onmessage({ data: JSON.stringify(event) })
  }

  it('takes a document deleted elsewhere out of what the chat asks about', async () => {
    const items = [documentNamed('a'), documentNamed('b'), documentNamed('c')]
    serve(items)
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about a' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about b' }))
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()

    // Deleted from another tab or the API, not from this page.
    items.splice(1, 1)
    push({ type: 'document.deleted', document_id: 'b' })
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Stop asking about b' }),
      ).toBeNull(),
    )
    expect(
      screen.getByRole('button', { name: 'Stop asking about a' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull()
  })

  it('leaves the chat alone when a document it does not ask about is deleted', async () => {
    const items = [documentNamed('a'), documentNamed('b'), documentNamed('c')]
    serve(items)
    render(createElement(DocumentWorkspace))
    await screen.findByRole('button', { name: 'a' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about a' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask about b' }))

    items.splice(2, 1)
    push({ type: 'document.deleted', document_id: 'c' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'c' })).toBeNull(),
    )
    expect(
      screen.getByRole('button', { name: 'Stop asking about a' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Stop asking about b' }),
    ).toBeTruthy()
  })

  it('keeps every version’s status current while the dialog is open', async () => {
    const version = (id, number, status) => ({
      id,
      version_number: number,
      filename: `${id}.pdf`,
      title: null,
      size_bytes: 1000,
      status,
      is_latest: number === 2,
      created_at: '2026-11-04T06:00:00Z',
    })
    const versions = [version('a', 2, 'embedded'), version('old', 1, 'queued')]
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url)
        if (path.includes('/health/queue'))
          return Promise.resolve(Response.json(RUNNING))
        if (/\/documents\/a\/versions$/.test(path))
          return Promise.resolve(Response.json({ versions: [...versions] }))
        if (/\/documents\/a$/.test(path))
          return Promise.resolve(Response.json(documentNamed('a')))
        if (/\/documents(\?|$)/.test(path))
          return Promise.resolve(
            Response.json({
              items: [documentNamed('a')],
              total: 1,
              limit: 10,
              offset: 0,
            }),
          )
        return Promise.resolve(Response.json({}))
      }),
    )
    render(createElement(DocumentWorkspace))
    fireEvent.click(await screen.findByRole('button', { name: 'a' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Details' }))
    const list = () => screen.getByRole('list', { name: 'Document versions' })
    await waitFor(() => expect(list().textContent).toContain('Queued'))

    // Another version finishes processing; it is not the document that is open.
    versions[1] = version('old', 1, 'embedded')
    push({ type: 'document.status', document_id: 'old', status: 'embedded' })
    await waitFor(() => expect(list().textContent).not.toContain('Queued'))
  })
})
