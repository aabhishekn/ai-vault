// @vitest-environment jsdom
import { createElement } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsPanel } from './AnalyticsPanel'

afterEach(cleanup)
const stats = {
  total_documents: 3,
  total_storage_bytes: 388410,
  documents_with_summary: 2,
  total_extracted_pages: 12,
  total_chunks: 12,
  chunks_with_embeddings: 6,
  by_status: {
    queued: 0,
    processing: 0,
    extracted: 2,
    embedded: 1,
    ready: 0,
    failed: 0,
  },
}
const metrics = {
  total_attempts: 1,
  processing: 0,
  succeeded: 1,
  failed: 0,
  success_rate: 1,
  average_duration_ms: 129,
  average_success_duration_ms: 129,
  average_failure_duration_ms: null,
  max_duration_ms: 1500,
  observed_embedding_input_tokens: 0,
}

function route(overrides = {}) {
  const fetch = vi.fn((url) =>
    (
      overrides[url] ??
      (() =>
        Promise.resolve(
          Response.json(url.endsWith('/documents') ? stats : metrics),
        ))
    )(),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('workspace overview', () => {
  it('shows document statistics and processing metrics', async () => {
    route()
    render(createElement(AnalyticsPanel))
    const documents = await screen.findByRole('region', { name: 'Documents' })
    expect(within(documents).getByText('3')).toBeTruthy()
    expect(within(documents).getByText('379.3 KB')).toBeTruthy()
    expect(within(documents).getByText('6 / 12')).toBeTruthy()
    expect(within(documents).getByText('Text extracted: 2')).toBeTruthy()
    const processing = await screen.findByRole('region', { name: 'Processing' })
    await waitFor(() =>
      expect(within(processing).getByText('100%')).toBeTruthy(),
    )
    expect(within(processing).getByText('129 ms')).toBeTruthy()
    expect(within(processing).getByText('1.5 s')).toBeTruthy()
  })
  it('shows an empty state when nothing has been processed', async () => {
    route({
      '/api/metrics/processing': () =>
        Promise.resolve(
          Response.json({
            ...metrics,
            total_attempts: 0,
            succeeded: 0,
            success_rate: null,
            average_duration_ms: null,
            max_duration_ms: null,
          }),
        ),
    })
    render(createElement(AnalyticsPanel))
    expect(await screen.findByText(/No processing attempts/)).toBeTruthy()
  })
  it('keeps one section usable when the other endpoint fails, and refresh retries', async () => {
    let fail = true
    const fetch = route({
      '/api/metrics/processing': () =>
        fail
          ? Promise.resolve(Response.json({}, { status: 503 }))
          : Promise.resolve(Response.json(metrics)),
    })
    render(createElement(AnalyticsPanel))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'document service is unavailable',
    )
    expect(
      await screen.findByText('Documents', { selector: 'dt' }),
    ).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overview' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await screen.findByText('129 ms')).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
