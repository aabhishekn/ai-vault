// @vitest-environment jsdom
import { createElement } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentActions } from './DocumentActions'

afterEach(cleanup)

const queued = {
  id: 'doc-1',
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 10,
  status: 'queued',
  created_at: '2026-11-04T06:00:00Z',
}

function setup(status, fetch) {
  vi.stubGlobal('fetch', fetch)
  const onDeleted = vi.fn()
  const onReprocessed = vi.fn()
  render(
    createElement(DocumentActions, {
      id: 'doc-1',
      status,
      onDeleted,
      onReprocessed,
    }),
  )
  return { onDeleted, onReprocessed }
}

const calls = (fetch, method) =>
  fetch.mock.calls.filter(([, options]) => options?.method === method)

describe('document actions', () => {
  it.each(['queued', 'processing', 'embedded', 'ready'])(
    'does not offer processing again while a document is %s',
    (status) => {
      setup(status, vi.fn())
      expect(screen.queryByRole('button', { name: 'Process again' })).toBeNull()
      expect(
        screen.getByRole('button', { name: /Delete document/ }),
      ).toBeTruthy()
    },
  )

  it.each(['failed', 'extracted'])(
    'queues a %s document again and tells the parent',
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(queued))
      const { onReprocessed } = setup(status, fetch)
      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
      await waitFor(() => expect(onReprocessed).toHaveBeenCalledOnce())
      expect(calls(fetch, 'POST')).toHaveLength(1)
      expect(screen.getByRole('status').textContent).toMatch(/Queued/)
    },
  )

  it('shows why queueing failed and stays usable', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ detail: 'x' }, { status: 503 }))
    const { onReprocessed } = setup('failed', fetch)
    fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /queue is unavailable/,
    )
    expect(onReprocessed).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole('button', { name: 'Process again' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('asks for confirmation before deleting anything', () => {
    const fetch = vi.fn()
    setup('embedded', fetch)
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    expect(screen.getByText('Delete this document permanently?')).toBeTruthy()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('focuses Cancel first, and Cancel returns to Delete without deleting', () => {
    const fetch = vi.fn()
    const { onDeleted } = setup('embedded', fetch)
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.click(cancel)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Delete document/ }),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('deletes every version once confirmed and tells the parent', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const { onDeleted } = setup('embedded', fetch)
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    const [[url]] = calls(fetch, 'DELETE')
    expect(url).toBe('/api/documents/doc-1?all_versions=true')
  })

  it('keeps the document and explains a refused delete', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ detail: 'x' }, { status: 409 }))
    const { onDeleted } = setup('embedded', fetch)
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /still being processed/,
    )
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('sends only one delete however often the button is pressed', async () => {
    let finish
    const fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(new Response(null, { status: 204 }))
        }),
    )
    const { onDeleted } = setup('embedded', fetch)
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    const confirm = screen.getByRole('button', { name: 'Delete permanently' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(
      screen
        .getByRole('button', { name: 'Deleting…' })
        .hasAttribute('disabled'),
    ).toBe(true)
    finish()
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(calls(fetch, 'DELETE')).toHaveLength(1)
  })
})
