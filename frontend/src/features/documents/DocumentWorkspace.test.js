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

function serve(items) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      Promise.resolve(
        String(url).includes('/documents')
          ? Response.json({ items, total: items.length, limit: 10, offset: 0 })
          : Response.json({ categories: [], tags: [] }),
      ),
    ),
  )
}

describe('document workspace selection hint', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  // The word "Select" is bold, so match the surrounding text of the paragraph.
  const hint = /on two or more documents to ask across them/i

  it('explains multi-document actions when two documents can be asked about', async () => {
    serve([documentNamed('a'), documentNamed('b')])
    render(createElement(DocumentWorkspace))
    expect(await screen.findByText(hint)).toBeTruthy()
  })

  it('swaps the hint for the selection bar once a document is chosen', async () => {
    serve([documentNamed('a'), documentNamed('b')])
    render(createElement(DocumentWorkspace))
    await screen.findByText(hint)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(screen.queryByText(hint)).toBeNull())
    expect(screen.getByText(/1 selected/)).toBeTruthy()
  })

  it('stays out of the way with a single selectable document', async () => {
    serve([documentNamed('a'), documentNamed('b', 'queued')])
    render(createElement(DocumentWorkspace))
    await screen.findByText('a.pdf')
    expect(screen.queryByText(hint)).toBeNull()
  })
})
