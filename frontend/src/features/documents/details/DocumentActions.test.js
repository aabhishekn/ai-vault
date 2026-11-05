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
import { ApiError } from '../../../lib/api'
import { DocumentActions } from './DocumentActions'

afterEach(cleanup)

function setup(status, onReprocess = vi.fn().mockResolvedValue({})) {
  const onDelete = vi.fn()
  render(createElement(DocumentActions, { status, onDelete, onReprocess }))
  return { onDelete, onReprocess }
}

describe('document actions', () => {
  it.each(['queued', 'processing', 'embedded', 'ready'])(
    'does not offer processing again while a document is %s',
    (status) => {
      setup(status)
      expect(screen.queryByRole('button', { name: 'Process again' })).toBeNull()
      expect(
        screen.getByRole('button', { name: /Delete document/ }),
      ).toBeTruthy()
    },
  )

  it.each(['failed', 'extracted'])(
    'asks to queue a %s document again',
    async (status) => {
      const { onReprocess } = setup(status)
      fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
      await waitFor(() => expect(onReprocess).toHaveBeenCalledOnce())
    },
  )

  it('says it is queued before the server has answered', () => {
    setup(
      'failed',
      vi.fn(() => new Promise(() => {})),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
    expect(screen.getByRole('status').textContent).toMatch(/Queued/)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('withdraws the queued message and says why when queueing is refused', async () => {
    const onReprocess = vi
      .fn()
      .mockRejectedValue(new ApiError('The processing queue is unavailable.'))
    setup('failed', onReprocess)
    fireEvent.click(screen.getByRole('button', { name: 'Process again' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /queue is unavailable/,
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Process again' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('asks for confirmation before deleting anything', () => {
    const { onDelete } = setup('embedded')
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    expect(screen.getByText('Delete this document permanently?')).toBeTruthy()
    expect(screen.getByText(/cannot be undone/)).toBeTruthy()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('focuses Cancel first, and Cancel returns to Delete without deleting', () => {
    const { onDelete } = setup('embedded')
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.click(cancel)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Delete document/ }),
    )
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('hands the delete over once confirmed, however often the button is pressed', () => {
    const { onDelete } = setup('embedded')
    fireEvent.click(screen.getByRole('button', { name: /Delete document/ }))
    const confirm = screen.getByRole('button', { name: 'Delete permanently' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
