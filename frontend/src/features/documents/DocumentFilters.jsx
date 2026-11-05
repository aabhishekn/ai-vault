const select =
  'w-full cursor-pointer appearance-none truncate rounded-lg border border-panel-border bg-surface py-2 pr-8 pl-3 text-[13px] font-normal tracking-normal text-ink normal-case hover:border-[#c9c5b5] focus-visible:border-focus'

// A select with its own arrow, so both look the same in every browser.
function Field({ label, value, onChange, options }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
      {label}
      <div className="relative">
        <select
          className={select}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">All</option>
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.value} ({item.count})
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path
            d="M5.5 8l4.5 4.5L14.5 8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </label>
  )
}

export function DocumentFilters({ overview, filter, onChange }) {
  const active = Boolean(filter.category || filter.tag)
  return (
    <div className="grid shrink-0 gap-3 border-b border-rule bg-panel-footer px-4 py-3.5">
      <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
        <Field
          label="Category"
          value={filter.category ?? ''}
          options={overview.categories.map((item) => ({
            value: item.category,
            count: item.count,
          }))}
          onChange={(value) =>
            onChange({ ...filter, category: value || undefined })
          }
        />
        <Field
          label="Tag"
          value={filter.tag ?? ''}
          options={overview.tags.map((item) => ({
            value: item.tag,
            count: item.count,
          }))}
          onChange={(value) => onChange({ ...filter, tag: value || undefined })}
        />
      </div>
      {active && (
        <button
          type="button"
          className="w-fit cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-earth underline-offset-2 hover:underline"
          onClick={() => onChange({})}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
