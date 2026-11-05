// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentUpload } from './DocumentUpload'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const pdf = (name = 'Plan.pdf', bytes = 2048) =>
  new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })

const choose = (file) =>
  fireEvent.change(screen.getByLabelText('Document file'), {
    target: { files: [file] },
  })

const zone = () => screen.getByText(/Choose a file/).closest('label')

describe('document upload', () => {
  it('starts as a drop zone with no Upload button, and says what is accepted', () => {
    render(createElement(DocumentUpload))
    expect(screen.getByText(/or drag it here/)).toBeTruthy()
    expect(screen.getByText('PDF, PNG or JPG, up to 10 MB')).toBeTruthy()
    expect(screen.getByText(/read by your configured AI provider/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()
  })

  it('shows the chosen file with its size, and lets you remove it again', () => {
    render(createElement(DocumentUpload))
    choose(pdf('Plan.pdf', 2048))
    expect(screen.getByText('Plan.pdf')).toBeTruthy()
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled'),
    ).toBe(false)
    expect(screen.queryByText(/or drag it here/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Plan.pdf' }))
    expect(screen.getByText(/or drag it here/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()
  })

  it('refuses a file that cannot be uploaded and says why', () => {
    render(createElement(DocumentUpload))
    choose(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'Choose a PDF, PNG or JPG file.',
    )
    expect(
      screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('takes a dropped file, highlighting the zone while one is over it', () => {
    render(createElement(DocumentUpload))
    fireEvent.dragOver(zone())
    expect(screen.getByText('Drop to select it')).toBeTruthy()
    fireEvent.dragLeave(zone())
    expect(screen.getByText('PDF, PNG or JPG, up to 10 MB')).toBeTruthy()
    fireEvent.drop(zone(), { dataTransfer: { files: [pdf('Dropped.pdf')] } })
    expect(screen.getByText('Dropped.pdf')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
  })

  it('ignores a drop that carries no file', () => {
    render(createElement(DocumentUpload))
    fireEvent.drop(zone(), { dataTransfer: { files: [] } })
    expect(screen.getByText(/or drag it here/)).toBeTruthy()
  })

  it('locks the file while it uploads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    render(createElement(DocumentUpload))
    choose(pdf())
    fireEvent.submit(
      screen.getByRole('button', { name: 'Upload' }).closest('form'),
    )
    const busy = await screen.findByRole('button', { name: 'Uploading…' })
    expect(busy.hasAttribute('disabled')).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Remove Plan.pdf' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
