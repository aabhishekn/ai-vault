const variants = {
  secondary:
    'border-[#dedacd] bg-surface text-[#4a4943] enabled:hover:border-[#c9c5b5] enabled:hover:bg-[#efede4]',
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
