// Shown when Redis is up but no worker is listening, so new uploads would sit in the queue.
export function WorkerNotice({ health }) {
  if (!health || health.workerRunning) return null
  return (
    <p
      className="mb-4 rounded-[12px] border border-[#e6d6a8] bg-[#fffaf0] px-4 py-3 text-[13px] leading-[1.7] text-[#6b5a1e]"
      role="status"
    >
      Background processing is not running, so new uploads will wait in the
      queue.
    </p>
  )
}
