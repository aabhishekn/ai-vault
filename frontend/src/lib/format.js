const uploadedDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatUploadDate(value) {
  return uploadedDate.format(new Date(value))
}

// A readable title for a file name: no extension, spaces instead of underscores. Operating
// systems swap ":" for "_" in file names, so an underscore before a space reads back as a colon.
export function documentTitle(filename) {
  const title = filename
    .replace(/\.(pdf|png|jpe?g)$/i, '')
    .replace(/_\s+/g, ': ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\s]+$/, '')
    .trim()
  return title || filename
}

// What to call a document: the title it was given (by the AI or by a person) when it has
// one, otherwise a tidied file name.
export function displayTitle(item) {
  return item.title || documentTitle(item.filename)
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatCount(value) {
  return value.toLocaleString()
}

export function formatDuration(ms) {
  if (ms === null) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatPercent(ratio) {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`
}

// Text read out of a document for display. Word and some PDF makers draw bullets from a
// symbol font, which comes out as private-use characters that show as empty boxes.
export function readableText(text) {
  return text.replace(/[\uE000-\uF8FF]/g, '•')
}
