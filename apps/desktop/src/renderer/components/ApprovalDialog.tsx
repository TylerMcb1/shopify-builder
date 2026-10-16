import { useEffect, type KeyboardEvent } from 'react'
import { ShieldAlert } from 'lucide-react'
import {
  APPROVAL_APPROVE_LABEL,
  APPROVAL_DECLINE_LABEL,
  APPROVAL_MESSAGE,
  APPROVAL_PREVIEW_LABEL,
  APPROVAL_TITLE,
  approvalKeyAction,
} from '../../shared/approval.ts'
import { Button } from './Button.tsx'

export function ApprovalDialog({
  files,
  preview,
  onApprove,
  onDecline,
}: {
  files: { path: string; description: string }[]
  preview?: string
  onApprove: () => void
  onDecline: () => void
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (approvalKeyAction(event.key) !== 'decline') return
    event.preventDefault()
    onDecline()
  }

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (approvalKeyAction(event.key) !== 'decline') return
      event.preventDefault()
      onDecline()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDecline])

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]"
      onMouseDown={onDecline}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-message"
        className="animate-in w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-pop"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-warning-subtle text-warning">
          <ShieldAlert className="size-5" aria-hidden="true" />
        </span>
        <h2 id="approval-title" className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {APPROVAL_TITLE}
        </h2>
        <p id="approval-message" className="mt-2 text-[13.5px] leading-6 text-muted">
          {APPROVAL_MESSAGE}
        </p>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas">
          {files.map((file) => (
            <li key={file.path} className="px-3.5 py-2.5 text-[13px]">
              <p className="font-mono text-[12.5px] font-medium text-ink">{file.path}</p>
              <p className="mt-0.5 text-muted">{file.description}</p>
            </li>
          ))}
        </ul>
        {preview ? (
          <details className="mt-4 text-[13px]">
            <summary className="cursor-pointer font-medium text-primary">{APPROVAL_PREVIEW_LABEL}</summary>
            <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-canvas p-3 font-mono text-xs text-ink">{preview}</pre>
          </details>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="lg" autoFocus onClick={onDecline}>
            {APPROVAL_DECLINE_LABEL}
          </Button>
          <Button size="lg" onClick={onApprove}>
            {APPROVAL_APPROVE_LABEL}
          </Button>
        </div>
      </div>
    </div>
  )
}
