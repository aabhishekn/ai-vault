import type { DocumentFilter } from './api'
import type { TagsOverview } from './classification'

const select =
  'rounded-lg border border-panel-border bg-surface px-2.5 py-1.5 text-xs'

export function DocumentFilters({
  overview,
  filter,
  onChange,
}: {
  overview: TagsOverview
  filter: DocumentFilter
  onChange: (filter: DocumentFilter) => void
}) {
  if (
    overview.categories.length === 0 &&
    overview.tags.length === 0 &&
    !filter.category &&
    !filter.tag
  )
    return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-rule px-[26px] py-3 max-[600px]:px-[18px]">
      <label className="flex items-center gap-2 text-xs font-semibold">
        Category
        <select
          className={select}
          value={filter.category ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              category: event.currentTarget.value || undefined,
            })
          }
        >
          <option value="">All</option>
          {overview.categories.map((item) => (
            <option key={item.category} value={item.category}>
              {item.category} ({item.count})
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold">
        Tag
        <select
          className={select}
          value={filter.tag ?? ''}
          onChange={(event) =>
            onChange({ ...filter, tag: event.currentTarget.value || undefined })
          }
        >
          <option value="">All</option>
          {overview.tags.map((item) => (
            <option key={item.tag} value={item.tag}>
              {item.tag} ({item.count})
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
