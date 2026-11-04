import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  liveUpdatesUrl,
  openLiveUpdates,
  parseLiveEvent,
  type LiveEvent,
} from './liveUpdates'

class FakeSocket {
  static all: FakeSocket[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

const create = (url: string) => new FakeSocket(url) as unknown as WebSocket

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.all = []
  vi.useRealTimers()
})

describe('live update messages', () => {
  it('builds a ws or wss address from the page location', () => {
    expect(liveUpdatesUrl({ protocol: 'http:', host: 'a:1' })).toBe(
      'ws://a:1/api/ws/events',
    )
    expect(liveUpdatesUrl({ protocol: 'https:', host: 'a' })).toBe(
      'wss://a/api/ws/events',
    )
  })
  it.each([
    [
      '{"type":"document.status","document_id":"d","status":"ready","extra":1}',
      { type: 'document.status', document_id: 'd', status: 'ready' },
    ],
    ['{"type":"ready"}', { type: 'ready' }],
    ['not json', null],
    ['{"status":"x"}', null],
    ['[]', null],
    [42, null],
  ])('parses %j', (raw, expected) => {
    expect(parseLiveEvent(raw)).toEqual(expected)
  })
})

describe('openLiveUpdates', () => {
  it('reports the connection and forwards events', () => {
    const events: LiveEvent[] = []
    const states: boolean[] = []
    openLiveUpdates({
      onEvent: (event) => events.push(event),
      onConnection: (connected) => states.push(connected),
      createSocket: create,
    })
    const socket = FakeSocket.all[0]
    socket.send('{"type":"ready"}')
    socket.send(
      '{"type":"document.status","document_id":"d","status":"embedded"}',
    )
    socket.send('garbage')
    expect(states).toEqual([true])
    expect(events.map((event) => event.type)).toEqual([
      'ready',
      'document.status',
    ])
  })
  it('reconnects with a growing delay and stops when closed', () => {
    vi.useFakeTimers()
    const states: boolean[] = []
    const stop = openLiveUpdates({
      onEvent: () => {},
      onConnection: (connected) => states.push(connected),
      createSocket: create,
    })
    FakeSocket.all[0].onclose?.()
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1].onclose?.()
    vi.advanceTimersByTime(1_999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    stop()
    expect(FakeSocket.all[2].closed).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(3)
    expect(states).toEqual([false, false])
  })
})
