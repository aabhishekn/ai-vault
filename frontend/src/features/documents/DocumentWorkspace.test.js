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

describe('background worker notice', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', IdleSocket)
  })

  const notice = /background worker is not running/i

  it('warns that uploads will stay queued when no worker is running', async () => {
    serve([documentNamed('a')], {
      status: 'no_workers',
      redis: 'connected',
      workers: 0,
      queued_jobs: 2,
    })
    render(createElement(DocumentWorkspace))
    const warning = await screen.findByText(notice)
    expect(warning.textContent).toMatch(/2 waiting now/)
    expect(warning.textContent).toMatch(/python -m app\.worker/)
  })

  it('stays quiet when a worker is running', async () => {
    serve([documentNamed('a')])
    render(createElement(DocumentWorkspace))
    await screen.findByText('a.pdf')
    expect(screen.queryByText(notice)).toBeNull()
  })

  it('never warns when the check itself fails', async () => {
    serve([documentNamed('a')], null)
    render(createElement(DocumentWorkspace))
    await screen.findByText('a.pdf')
    expect(screen.queryByText(notice)).toBeNull()
  })
})
