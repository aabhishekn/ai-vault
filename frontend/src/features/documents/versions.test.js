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
import { ApiError } from '../../lib/api'
import { isDocument } from './api'
import { DocumentVersions } from './DocumentVersions'
import { uploadNewVersion } from './upload'
import { getVersions } from './versions'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const signal = () => new AbortController().signal
const version = (n, latest) => ({
  id: `doc-${n}`,
  version_number: n,
  filename: `report-v${n}.pdf`,
  size_bytes: 2048,
  status: 'embedded',
  is_latest: latest,
  created_at: '2026-11-04T00:00:00Z',
})
const pdf = (name = 'new.pdf') =>
  new File(['%PDF-1.4 x'], name, { type: 'application/pdf' })

describe('versions API', () => {
  it('reads the version list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          group_id: 'g',
          versions: [version(2, true), version(1, false)],
        }),
      ),
    )
    const versions = await getVersions('doc-2', signal())
    expect(versions.map((v) => v.version_number)).toEqual([2, 1])
  })

  it('rejects malformed version data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ versions: [{ id: 'x' }] })),
    )
    await expect(getVersions('d', signal())).rejects.toThrow(
      /unexpected versions/,
    )
  })

  it('uploads a file to the versions endpoint', async () => {
    const created = {
      id: 'doc-3',
      filename: 'new.pdf',
      content_type: 'application/pdf',
      size_bytes: 9,
      status: 'queued',
      version_number: 3,
      is_latest: true,
      created_at: '2026-11-04T00:00:00Z',
    }
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json(created, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      uploadNewVersion('doc 2', pdf(), signal()),
    ).resolves.toMatchObject({
      version_number: 3,
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/documents/doc%202/versions')
  })

  it.each([
    [404, /could not be found/],
    [409, /identical/],
    [429, /Too many uploads/],
  ])('explains status %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    )
    const error = await uploadNewVersion('d', pdf(), signal()).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toMatch(message)
  })

  it('accepts version fields on documents and rejects bad ones', () => {
    const doc = {
      id: 'a',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      size_bytes: 5,
      status: 'embedded',
      created_at: '2026-11-04T00:00:00Z',
    }
    expect(isDocument({ ...doc, version_number: 2, is_latest: true })).toBe(
      true,
    )
    expect(isDocument({ ...doc, version_number: 0 })).toBe(false)
    expect(isDocument({ ...doc, is_latest: 'yes' })).toBe(false)
  })
})

describe('versions panel', () => {
  it('lists versions, opens another one, and uploads a new one', async () => {
    const fetch = vi.fn((_url, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? Response.json(
              {
                id: 'doc-3',
                filename: 'new.pdf',
                content_type: 'application/pdf',
                size_bytes: 9,
                status: 'queued',
                created_at: '2026-11-04T00:00:00Z',
              },
              { status: 201 },
            )
          : Response.json({
              group_id: 'g',
              versions: [version(2, true), version(1, false)],
            }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const onOpen = vi.fn()
    const onVersionAdded = vi.fn()
    render(
      createElement(DocumentVersions, { id: 'doc-2', onOpen, onVersionAdded }),
    )
    expect(await screen.findByText(/report-v1/)).toBeTruthy()
    expect(screen.getByText('Viewing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open v1' }))
    expect(onOpen).toHaveBeenCalledWith('doc-1')
    fireEvent.change(screen.getByLabelText('Upload a new version'), {
      target: { files: [pdf()] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload version' }))
    await waitFor(() => expect(onVersionAdded).toHaveBeenCalledWith('doc-3'))
  })

  it('does not list a document that has only one version', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({ group_id: 'g', versions: [version(1, true)] }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    render(
      createElement(DocumentVersions, {
        id: 'doc-1',
        onOpen: vi.fn(),
        onVersionAdded: vi.fn(),
      }),
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText('Loading versions…')).toBeNull(),
    )
    expect(screen.queryByRole('list', { name: 'Document versions' })).toBeNull()
    expect(screen.getByLabelText('Upload a new version')).toBeTruthy()
  })

  it('shows why an upload failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? new Response('{}', { status: 409 })
            : Response.json({ group_id: 'g', versions: [version(1, true)] }),
        ),
      ),
    )
    render(
      createElement(DocumentVersions, {
        id: 'doc-1',
        onOpen: vi.fn(),
        onVersionAdded: vi.fn(),
      }),
    )
    await screen.findByLabelText('Upload a new version')
    fireEvent.change(screen.getByLabelText('Upload a new version'), {
      target: { files: [pdf()] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload version' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/identical/)
  })
})
