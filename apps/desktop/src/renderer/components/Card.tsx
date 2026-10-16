import type { ReactNode } from 'react'

export function Card({
  title,
  description,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card ${className}`}>
      {title ? (
        <header className="flex items-start gap-3">
          {icon ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-subtle text-primary [&>svg]:size-[18px]">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children ? <div className={`${title ? 'mt-4' : ''} space-y-4 text-[13.5px] text-muted`}>{children}</div> : null}
    </section>
  )
}

/** Title and summary at the top of each screen, in the macOS large-title style. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.06em] text-primary">{eyebrow}</p> : null}
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-xl text-[14px] leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Inline message under an action. */
export function Note({ tone = 'neutral', children }: { tone?: 'neutral' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const styles = {
    neutral: 'bg-control text-ink',
    warning: 'bg-warning-subtle text-warning',
    danger: 'bg-danger-subtle text-danger',
    success: 'bg-primary-subtle text-primary',
  } as const
  return (
    <p role="status" className={`animate-in rounded-lg px-3 py-2 text-[13px] leading-5 ${styles[tone]}`}>
      {children}
    </p>
  )
}
