const variants = {
  secondary:
    'border-[#dddfd4] bg-surface text-[#4f584b] enabled:hover:border-[#bfc7b3] enabled:hover:bg-[#f1f3e9]',
  danger:
    'border-[#e6c9c3] bg-surface text-error enabled:hover:border-error enabled:hover:bg-[#fdf1ee]',
  primary:
    'border-brand bg-brand text-surface enabled:hover:border-brand-hover enabled:hover:bg-brand-hover',
}

export function Button({
  className = '',
  type = 'button',
  variant = 'secondary',
  ...props
}) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-[7px] rounded-[7px] border px-3 py-2 text-xs font-[550] transition-[background,border-color] duration-150 disabled:cursor-default disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none [&_svg]:size-3.5 ${variants[variant]} ${className}`}
      {...props}
    />
  )
}
