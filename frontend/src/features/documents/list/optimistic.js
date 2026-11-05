// Optimistic list changes: show what someone just asked for before the server confirms it.
//
// The overlay only covers requests that are still in flight. When the server answers, the
// confirmed result is written into the real list (see the with* helpers below) and the
// overlay entry is dropped; when it refuses, the entry is simply dropped and the list is
// exactly what it was before.

export const NO_OVERLAY = {
  // Rows to hide: documents being deleted.
  hidden: new Set(),
  // id -> { from, to }: a status shown ahead of the server. Ignored once the server's own
  // status is no longer `from`, so a stale guess can never mask a real change.
  statuses: new Map(),
  // id -> title (null shows the file name): a rename not yet confirmed.
  titles: new Map(),
  // The upload in flight, shown as a row at the top of the first page.
  uploading: null,
}

export function pendingUpload(file) {
  return {
    id: 'pending-upload',
    filename: file.name,
    content_type: file.type || 'application/pdf',
    size_bytes: file.size,
    status: 'uploading',
    created_at: new Date().toISOString(),
    pending: true,
  }
}

export function effectiveStatus(document, statuses) {
  const guess = statuses.get(document.id)
  return guess && guess.from === document.status ? guess.to : document.status
}

// The page to display: the server's page with in-flight changes laid over it. Returns the
// same object when there is nothing to lay over, so memoised consumers do not reload.
export function applyOverlay(page, overlay, filtered) {
  const showUpload =
    overlay.uploading !== null && page.offset === 0 && !filtered
  const hiddenHere = page.items.filter((item) =>
    overlay.hidden.has(item.id),
  ).length
  if (
    !showUpload &&
    hiddenHere === 0 &&
    overlay.statuses.size === 0 &&
    overlay.titles.size === 0
  )
    return page
  const items = page.items
    .filter((item) => !overlay.hidden.has(item.id))
    .map((item) => {
      const status = effectiveStatus(item, overlay.statuses)
      const renamed = overlay.titles.has(item.id)
      return status === item.status && !renamed
        ? item
        : {
            ...item,
            status,
            ...(renamed ? { title: overlay.titles.get(item.id) } : {}),
          }
    })
  return {
    ...page,
    items: showUpload ? [overlay.uploading, ...items] : items,
    total: page.total - hiddenHere + (showUpload ? 1 : 0),
  }
}

// Confirmed changes, written into the server's page the moment the server answers so the
// row never flickers back while the list reloads.

export function withoutDocument(page, id) {
  if (!page.items.some((item) => item.id === id)) return page
  return {
    ...page,
    items: page.items.filter((item) => item.id !== id),
    total: Math.max(0, page.total - 1),
  }
}

export function withAddedDocument(page, document) {
  if (page.offset !== 0 || page.items.some((item) => item.id === document.id))
    return page
  return {
    ...page,
    items: [document, ...page.items].slice(0, page.limit),
    total: page.total + 1,
  }
}

export function withReplacedDocument(page, document) {
  if (!page.items.some((item) => item.id === document.id)) return page
  return {
    ...page,
    items: page.items.map((item) =>
      item.id === document.id ? { ...item, ...document } : item,
    ),
  }
}
