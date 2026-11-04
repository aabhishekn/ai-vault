import type { DocumentStatus } from './types'

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  extracted: 'Text extracted',
  embedded: 'Search ready',
  ready: 'Ready',
  failed: 'Failed',
}
