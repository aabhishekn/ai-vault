export const STATUS_LABELS = {
  // Only ever shown for an upload that is still on its way to the server.
  uploading: 'Uploading',
  queued: 'Queued',
  processing: 'Processing',
  extracted: 'Text extracted',
  embedded: 'Search ready',
  ready: 'Ready',
  failed: 'Failed',
}

// One short line next to the status badge; nothing is said once a document is ready to use.
export const DOCUMENT_STATUS_HINTS = {
  queued: 'Waiting to be processed.',
  processing: 'Being processed now.',
  extracted: 'Text is extracted, but questions need the search index.',
  failed: 'Processing failed. The file is still saved.',
}
