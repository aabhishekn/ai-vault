import { ApiError, getJson } from '../../lib/api'

// Whether a background worker is running; without one, uploads stay queued.
export async function getQueueHealth(signal) {
  const data = await getJson('/health/queue', signal)
  if (
    typeof data !== 'object' ||
    data === null ||
    !('status' in data) ||
    (data.status !== 'ok' && data.status !== 'no_workers') ||
    !Number.isSafeInteger(data.workers) ||
    data.workers < 0 ||
    !Number.isSafeInteger(data.queued_jobs) ||
    data.queued_jobs < 0
  )
    throw new ApiError('The service returned an unexpected queue status.')
  return {
    workerRunning: data.workers > 0,
    workers: data.workers,
    queuedJobs: data.queued_jobs,
  }
}
