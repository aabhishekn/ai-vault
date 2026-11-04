export const STATUS_LABELS = {
  queued: 'Queued',
  processing: 'Processing',
  extracted: 'Text extracted',
  embedded: 'Search ready',
  ready: 'Ready',
  failed: 'Failed',
}

export const DOCUMENT_STATUS_DESCRIPTIONS = {
  queued:
    'Your PDF is saved and waiting for the background worker to process it.',
  processing:
    'The background worker is processing your PDF. Refresh to check its progress.',
  extracted:
    'Text extraction is complete. Search and answers become available once embeddings are created.',
  embedded:
    'Your document is indexed for semantic search and source-cited answers.',
  ready: 'Your document has finished processing.',
  failed:
    'Processing failed. The PDF is still saved, but its content may not be available.',
}
