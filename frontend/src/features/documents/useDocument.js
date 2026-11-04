import { useResource } from '../../hooks/useResource'
import { getDocument } from './api'

export function useDocument(id) {
  return useResource(
    id,
    getDocument,
    'We couldn’t load this document. Check your connection and try again.',
  )
}
