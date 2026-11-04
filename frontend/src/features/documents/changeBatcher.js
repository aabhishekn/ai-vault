/**
 * Collects change notifications and delivers them together after a quiet moment.
 * `null` means "everything may have changed" and absorbs anything else in the batch.
 */
export function createChangeBatcher(deliver, delayMs) {
  let timer
  let pending

  function flush() {
    const batch = pending
    pending = undefined
    if (batch !== undefined) deliver(batch)
  }

  return {
    add(change) {
      if (change === null) pending = null
      else if (pending !== null) {
        pending ??= { ids: new Set(), content: new Set() }
        for (const id of change.ids) pending.ids.add(id)
        for (const id of change.content) pending.content.add(id)
      }
      clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    cancel() {
      clearTimeout(timer)
      pending = undefined
    },
  }
}
