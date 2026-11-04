// Shown when Redis is up but no worker is listening, so new uploads would sit in the queue.
export function WorkerNotice({ health }) {
  if (!health || health.workerRunning) return null
  return (
    <p
      className="mb-4 rounded-[12px] border border-[#e6d6a8] bg-[#fffaf0] px-4 py-3 text-[13px] leading-[1.7] text-[#6b5a1e]"
      role="status"
    >
      The background worker is not running, so uploaded documents will stay
      queued
      {health.queuedJobs > 0 ? ` (${health.queuedJobs} waiting now)` : ''}.
      Start it with{' '}
      <code className="font-mono text-xs">python -m app.worker</code> from{' '}
      <code className="font-mono text-xs">backend/</code>.
    </p>
  )
}
