export const DOCUMENT_STATUSES = [
  'queued',
  'processing',
  'extracted',
  'embedded',
  'ready',
  'failed',
] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export type VaultDocument = {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  status: DocumentStatus
  created_at: string
}

export type DocumentPage = {
  items: VaultDocument[]
  total: number
  limit: number
  offset: number
}
