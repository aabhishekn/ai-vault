import { useEffect, useRef, useState } from 'react'
import { openLiveUpdates } from '../../../lib/liveUpdates'
import { createChangeBatcher } from './changeBatcher'

const DEBOUNCE_MS = 300

/**
 * Subscribes to server-pushed document events while mounted and returns whether the
 * connection is live. `onChange` receives the ids of documents that changed (which of
 * those had content generated, and which were deleted), or `null` after a reconnect,
 * meaning anything may have changed while disconnected.
 */
export function useLiveUpdates(onChange) {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onChange)
  const everConnected = useRef(false)
  useEffect(() => {
    handler.current = onChange
  })

  useEffect(() => {
    const batcher = createChangeBatcher((changes) => {
      handler.current(changes)
    }, DEBOUNCE_MS)
    const stop = openLiveUpdates({
      onConnection: setConnected,
      onEvent: (event) => {
        if (event.type === 'ready') {
          // The first connection matches what was just loaded; later ones may have missed events.
          if (everConnected.current) batcher.add(null)
          everConnected.current = true
        } else if (event.document_id) {
          batcher.add({
            ids: new Set([event.document_id]),
            content: new Set(
              event.type === 'document.content' ? [event.document_id] : [],
            ),
            deleted: new Set(
              event.type === 'document.deleted' ? [event.document_id] : [],
            ),
          })
        }
      },
    })
    return () => {
      batcher.cancel()
      stop()
    }
  }, [])

  return connected
}
