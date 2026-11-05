// What shows while the AI works on something: three bouncing dots, what is happening, and
// a reminder to stay. It is a status region, so screen readers hear the title once.
export function Working({
  title,
  hint = 'Keep this view open. This can take a few seconds.',
  className = '',
}) {
  return (
    <div
      role="status"
      className={`flex items-center gap-3.5 rounded-xl border border-panel-border bg-panel-footer px-4 py-3.5 ${className}`}
    >
      <span
        className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[#f3e3d9] px-3"
        aria-hidden="true"
      >
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-brand motion-reduce:animate-pulse"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 wrap-anywhere">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-[12px] leading-[1.6] text-muted">
          {hint}
        </span>
      </span>
    </div>
  )
}
