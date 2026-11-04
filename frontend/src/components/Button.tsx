import type { ComponentPropsWithoutRef } from 'react'
import './Button.css'

export function Button({
  className = '',
  type = 'button',
  ...props
}: ComponentPropsWithoutRef<'button'>) {
  return (
    <button type={type} className={`button ${className}`.trim()} {...props} />
  )
}
