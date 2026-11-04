// Accessible tabs (arrow keys, Home and End move between them). The caller renders every
// TabPanel and the inactive ones are hidden, so work inside a panel, such as a chat in
// progress, survives switching tabs.
export function TabPanel({ idBase, tab, active, children }) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tab}`}
      aria-labelledby={`${idBase}-tab-${tab}`}
      hidden={active !== tab}
    >
      {children}
    </div>
  )
}

export function TabList({ idBase, label, tabs, active, onChange }) {
  function onKeyDown(event) {
    const index = tabs.findIndex((tab) => tab.id === active)
    const next = {
      ArrowRight: tabs[(index + 1) % tabs.length],
      ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs[tabs.length - 1],
    }[event.key]
    if (!next) return
    event.preventDefault()
    onChange(next.id)
    document.getElementById(`${idBase}-tab-${next.id}`)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 border-b border-rule"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          className={`-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-3.5 py-2.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
            tab.id === active
              ? 'border-brand text-ink'
              : 'border-transparent text-muted hover:text-ink'
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
