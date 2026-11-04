import { displayTitle } from '../../lib/format'
import { canAskDocument } from './answers'

// What the chat is about. The backend takes one document or 2 to 10 of them.
export const MAX_SCOPE = 10

/**
 * The documents a question is asked of.
 *
 * Documents the person ticked win; with none ticked it is every document that can be asked
 * about (the newest ten, the backend's limit). `key` changes only when the conversation
 * should start fresh: the "all" scope keeps one key while documents finish processing, so
 * a thread in progress is never reset by something happening in the background.
 *
 * @param {Map<string,string>} chosen ticked documents (id -> title)
 * @param {Array<{id:string,title:string}>} ready documents that can be asked about, newest first
 */
export function chatScope(chosen, ready) {
  if (chosen.size > 0) {
    const items = [...chosen].map(([id, name]) => ({ id, name }))
    const ids = items.map((item) => item.id)
    return {
      kind: items.length === 1 ? 'single' : 'picked',
      items,
      ids,
      key: items.length === 1 ? ids[0] : `picked:${[...ids].sort().join(',')}`,
      truncated: false,
      total: items.length,
    }
  }
  if (ready.length === 0)
    return {
      kind: 'none',
      items: [],
      ids: [],
      key: 'none',
      truncated: false,
      total: 0,
    }
  const items = ready.slice(0, MAX_SCOPE)
  const ids = items.map((item) => item.id)
  if (items.length === 1)
    return {
      kind: 'single',
      items,
      ids,
      key: ids[0],
      truncated: false,
      total: 1,
      implicit: true,
    }
  return {
    kind: 'all',
    items,
    ids,
    key: 'all',
    truncated: ready.length > MAX_SCOPE,
    total: ready.length,
    implicit: true,
  }
}

// Documents that can be asked about, from a list of documents as the server returns them.
export function readyEntries(documents) {
  return documents
    .filter((item) => canAskDocument(item.status))
    .map((item) => ({ id: item.id, name: displayTitle(item) }))
}
