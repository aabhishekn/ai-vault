export function TagChips({ category, tags, max }) {
  const shown = max === undefined ? (tags ?? []) : (tags ?? []).slice(0, max)
  if (!category && shown.length === 0) return null
  return (
    <ul
      className="flex list-none flex-wrap gap-1.5"
      aria-label="Category and tags"
    >
      {category && (
        <li className="rounded-[7px] bg-[#e4ead9] px-2 py-0.5 text-[11px] font-semibold text-[#3e4a37]">
          {category}
        </li>
      )}
      {shown.map((tag) => (
        <li
          key={tag}
          className="rounded-[7px] bg-[#f0f1e9] px-2 py-0.5 text-[11px] text-[#58634f]"
        >
          {tag}
        </li>
      ))}
    </ul>
  )
}
