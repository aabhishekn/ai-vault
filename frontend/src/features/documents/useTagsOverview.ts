import { useEffect, useState } from 'react'
import { getTagsOverview, type TagsOverview } from './classification'

const EMPTY: TagsOverview = { categories: [], tags: [] }

// Filter choices are a convenience: if they fail to load the list still works.
export function useTagsOverview(reloadKey: unknown): TagsOverview {
  const [overview, setOverview] = useState<TagsOverview>(EMPTY)
  useEffect(() => {
    const controller = new AbortController()
    getTagsOverview(
      AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    )
      .then((data) => {
        if (!controller.signal.aborted) setOverview(data)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [reloadKey])
  return overview
}
