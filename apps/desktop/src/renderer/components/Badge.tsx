import type { ReactNode } from 'react'

type Tone = 'ready' | 'warning' | 'danger' | 'neutral'

const styles: Record<Tone, string> = {
  ready: 'bg-primary-subtle text-primary',
  warning: 'bg-canvas text-warning',
  danger: 'bg-canvas text-danger',
  neutral: 'bg-canvas text-muted',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{children}</span>
}
