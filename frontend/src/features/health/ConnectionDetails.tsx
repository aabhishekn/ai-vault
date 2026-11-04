import { useState } from 'react'
import { HealthCard } from './HealthCard'

export function ConnectionDetails() {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="connection-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Service connection</summary>
      {open && <HealthCard />}
    </details>
  )
}
