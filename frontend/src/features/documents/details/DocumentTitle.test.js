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
import { DocumentTitle } from './DocumentTitle'

afterEach(cleanup)

function setup(props = {}) {
  const onRename = vi.fn().mockResolvedValue(undefined)
  render(
    createElement(DocumentTitle, {
      title: 'Case Study',
      source: null,
      onRename,
      ...props,
    }),
  )
  return { onRename }
}

const rename = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
const field = () => screen.getByLabelText('Title')
const save = () => fireEvent.submit(field().closest('form'))

describe('document title', () => {
  it.each([
    ['ai', /written by AI/],
    ['user', /set by you/],
    [null, /Showing the file name/],
  ])('says where a %s title came from', (source, note) => {
    setup({ source })
    expect(screen.getByText(note)).toBeTruthy()
  })

  it('opens a form holding the current title, focused and selected', () => {
    setup()
    rename()
    expect(field().value).toBe('Case Study')
    expect(document.activeElement).toBe(field())
    expect(
      screen.getByText(/Leave it empty to show the file name/),
    ).toBeTruthy()
  })

  it('saves what was typed and returns focus to Rename', async () => {
    const { onRename } = setup()
    rename()
    fireEvent.change(field(), { target: { value: 'Q3 Plan' } })
    save()
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Q3 Plan'))
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Rename' }),
    )
  })

  it('does not call the server when nothing changed', () => {
    const { onRename } = setup()
    rename()
    save()
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('closes with Escape or Cancel without saving', () => {
    const { onRename } = setup()
    rename()
    fireEvent.change(field(), { target: { value: 'Changed' } })
    expect(fireEvent.keyDown(field(), { key: 'Escape' })).toBe(false)
    expect(screen.queryByLabelText('Title')).toBeNull()
    rename()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('reopens with the typed text and the reason when saving is refused', async () => {
    setup({
      onRename: vi
        .fn()
        .mockRejectedValue(
          new ApiError('We couldn’t save the title. Try again.'),
        ),
    })
    rename()
    fireEvent.change(field(), { target: { value: 'Q3 Plan' } })
    save()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn’t save/,
    )
    expect(field().value).toBe('Q3 Plan')
  })
})
