// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetricsDialog } from './MetricsDialog'

const dialog = HTMLDialogElement.prototype
const original = { showModal: dialog.showModal, close: dialog.close }

beforeEach(() => {
  dialog.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  dialog.close = function close() {
    this.removeAttribute('open')
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('x', { status: 503 }))),
  )
})
afterEach(() => {
  cleanup()
  dialog.showModal = original.showModal
  dialog.close = original.close
  vi.unstubAllGlobals()
})

describe('metrics dialog', () => {
  it('opens as a modal with the overview and reads the numbers only then', () => {
    render(createElement(MetricsDialog, { onClose: vi.fn() }))
    expect(
      screen.getByRole('dialog', { name: 'Workspace metrics' }),
    ).toBeTruthy()
    expect(screen.getByText('Workspace overview')).toBeTruthy()
    expect(fetch).toHaveBeenCalled()
  })

  it('closes from the close button and on Escape', () => {
    const onClose = vi.fn()
    render(createElement(MetricsDialog, { onClose }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent(
      screen.getByRole('dialog', { name: 'Workspace metrics' }),
      new Event('cancel'),
    )
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
