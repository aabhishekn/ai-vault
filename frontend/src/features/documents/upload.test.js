import { describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES, uploadDocument, validateUpload } from './upload'

const document = {
  id: 'upload-id',
  filename: 'Notes.pdf',
  content_type: 'application/pdf',
  size_bytes: 20,
  status: 'queued',
  created_at: '2026-11-04T06:00:00Z',
}
const pdf = new File(['%PDF-test'], 'Notes.pdf', { type: 'application/pdf' })

describe('PDF upload', () => {
  it('accepts a PDF even if the browser supplies no MIME type', () => {
    expect(validateUpload(new File(['%PDF-test'], 'NOTES.PDF'))).toBeNull()
  })
  it.each(['scan.png', 'photo.JPG', 'photo.jpeg'])(
    'accepts the picture %s, which the server reads as a scanned page',
    (name) => {
      expect(validateUpload(new File(['image'], name))).toBeNull()
    },
  )
  it.each(['notes.docx', 'sheet.xlsx', 'animation.gif', 'archive.pdf.zip'])(
    'rejects %s, which cannot be read',
    (name) => {
      expect(validateUpload(new File(['data'], name))).toBe(
        'Choose a PDF, PNG or JPG file.',
      )
    },
  )
  it('accepts the exact size limit and rejects a larger file', () => {
    expect(
      validateUpload(new File([new Uint8Array(MAX_UPLOAD_BYTES)], 'max.pdf')),
    ).toBeNull()
    expect(
      validateUpload(
        new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'large.pdf'),
      ),
    ).toContain('10 MB')
  })
  it.each([
    [new File(['text'], 'notes.txt'), 'Choose a PDF'],
    [new File([], 'empty.pdf'), 'empty'],
    [new File(['%PDF-test'], `${'a'.repeat(252)}.pdf`), '255'],
  ])(
    'rejects invalid files before making any request',
    async (file, message) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(
        uploadDocument(file, new AbortController().signal),
      ).rejects.toThrow(message)
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it('sends multipart data, forwards cancellation, and validates the saved document', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json(document, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await expect(uploadDocument(pdf, signal)).resolves.toEqual(document)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/documents')
    expect(options.method).toBe('POST')
    expect(options.signal).toBe(signal)
    expect(options.headers).toEqual({ Accept: 'application/json' })
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toEqual(pdf)
  })
  it.each([
    [400, 'file was rejected'],
    [413, '10 MB'],
    [415, 'supported type'],
    [422, 'file was rejected'],
    [503, 'may already be saved'],
    [500, 'may already be saved'],
  ])('shows safe feedback for HTTP %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: 'private server internals' }, { status }),
        ),
    )
    await expect(
      uploadDocument(pdf, new AbortController().signal),
    ).rejects.toThrow(message)
  })
  it('does not retry a network failure that may have saved the file', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network failed'))
    vi.stubGlobal('fetch', fetch)
    await expect(
      uploadDocument(pdf, new AbortController().signal),
    ).rejects.toThrow('Refresh the document list')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('treats malformed success data as unconfirmed rather than claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ id: 'bad' })),
    )
    await expect(
      uploadDocument(pdf, new AbortController().signal),
    ).rejects.toThrow('couldn’t confirm')
  })
})
