import type { ReactNode } from 'react'

type Tone = 'ready' | 'warning' | 'danger' | 'neutral'

const styles: Record<Tone, string> = {
  ready: 'bg-primary-subtle text-primary',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  neutral: 'bg-control text-muted',
}

const dots: Record<Tone, string> = {
  ready: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-faint',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${styles[tone]}`}>
      <span className={`size-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />
      {children}
    </span>
  )
}
