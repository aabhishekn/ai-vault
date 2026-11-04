// Whether there is anything to filter by, so the list only offers a Filter button when it helps.
export function hasFilterChoices(overview, filter) {
  return (
    overview.categories.length > 0 ||
    overview.tags.length > 0 ||
    Boolean(filter.category || filter.tag)
  )
}
