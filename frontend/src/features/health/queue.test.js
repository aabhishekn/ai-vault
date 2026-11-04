import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { getQueueHealth } from './queue'

const signal = new AbortController().signal

function respond(body, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json(body, { status })),
  )
}

describe('queue health', () => {
  it('reads whether a worker is running and what is waiting', async () => {
    respond({ status: 'ok', redis: 'connected', workers: 2, queued_jobs: 5 })
    await expect(getQueueHealth(signal)).resolves.toEqual({
      workerRunning: true,
      workers: 2,
      queuedJobs: 5,
    })
  })

  it('reports no worker', async () => {
    respond({
      status: 'no_workers',
      redis: 'connected',
      workers: 0,
      queued_jobs: 0,
    })
    await expect(getQueueHealth(signal)).resolves.toMatchObject({
      workerRunning: false,
    })
  })

  it.each([
    null,
    {},
    { status: 'weird', workers: 1, queued_jobs: 0 },
    { status: 'ok', workers: -1, queued_jobs: 0 },
    { status: 'ok', workers: '1', queued_jobs: 0 },
    { status: 'ok', workers: 1 },
  ])('rejects an unexpected response %j', async (body) => {
    respond(body)
    await expect(getQueueHealth(signal)).rejects.toBeInstanceOf(ApiError)
  })

  it('fails when Redis is unavailable', async () => {
    respond({ detail: 'Job queue unavailable' }, 503)
    await expect(getQueueHealth(signal)).rejects.toBeInstanceOf(ApiError)
  })
})
