import { useState } from 'react'
import { HealthCard } from './HealthCard'

export function ConnectionDetails() {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="group mt-6"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="w-fit cursor-pointer py-2.5 text-xs text-muted group-open:mb-3">
        Service connection
      </summary>
      {open && <HealthCard />}
    </details>
  )
}
