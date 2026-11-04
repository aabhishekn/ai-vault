export type LiveEvent = {
  type: string
  document_id?: string
  status?: string
}

type Options = {
  onEvent: (event: LiveEvent) => void
  // Called with true once the server confirms the subscription, false when it drops.
  onConnection: (connected: boolean) => void
  // Test seam: how to create the socket.
  createSocket?: (url: string) => WebSocket
}

const FIRST_DELAY_MS = 1_000
const MAX_DELAY_MS = 15_000

export function liveUpdatesUrl(location: Pick<Location, 'protocol' | 'host'>) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/ws/events`
}

export function parseLiveEvent(raw: unknown): LiveEvent | null {
  if (typeof raw !== 'string') return null
  try {
    const data: unknown = JSON.parse(raw)
    if (
      typeof data !== 'object' ||
      data === null ||
      !('type' in data) ||
      typeof data.type !== 'string'
    )
      return null
    const event: LiveEvent = { type: data.type }
    if ('document_id' in data && typeof data.document_id === 'string')
      event.document_id = data.document_id
    if ('status' in data && typeof data.status === 'string')
      event.status = data.status
    return event
  } catch {
    return null
  }
}

/**
 * Keeps a WebSocket to the server open, reconnecting with a growing delay.
 * Events sent while disconnected are not replayed, so callers should refetch when
 * a `ready` event arrives after a drop. Returns a function that stops everything.
 */
export function openLiveUpdates({
  onEvent,
  onConnection,
  createSocket,
}: Options): () => void {
  const make =
    createSocket ??
    (typeof WebSocket === 'undefined'
      ? null
      : (url: string) => new WebSocket(url))
  if (!make) return () => {}
  const factory: (url: string) => WebSocket = make
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = FIRST_DELAY_MS
  let stopped = false

  function connect() {
    if (stopped) return
    try {
      socket = factory(liveUpdatesUrl(globalThis.location))
    } catch {
      schedule()
      return
    }
    socket.onmessage = (message: MessageEvent) => {
      const event = parseLiveEvent(message.data)
      if (!event) return
      if (event.type === 'ready') {
        delay = FIRST_DELAY_MS
        onConnection(true)
      }
      onEvent(event)
    }
    socket.onclose = () => {
      socket = null
      onConnection(false)
      schedule()
    }
    socket.onerror = () => socket?.close()
  }

  function schedule() {
    if (stopped) return
    timer = setTimeout(connect, delay)
    delay = Math.min(delay * 2, MAX_DELAY_MS)
  }

  connect()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (socket) {
      socket.onclose = null
      socket.close()
    }
  }
}
