import { useEffect, type KeyboardEvent } from 'react'
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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-ink/40 p-6" onMouseDown={onDecline}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-message"
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-sm"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="approval-title" className="text-lg font-semibold text-ink">
          {APPROVAL_TITLE}
        </h2>
        <p id="approval-message" className="mt-3 text-sm leading-6 text-muted">
          {APPROVAL_MESSAGE}
        </p>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {files.map((file) => (
            <li key={file.path} className="px-3 py-2 text-sm">
              <p className="font-medium text-ink">{file.path}</p>
              <p className="mt-1 text-muted">{file.description}</p>
            </li>
          ))}
        </ul>
        {preview ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-primary">{APPROVAL_PREVIEW_LABEL}</summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-canvas p-3 text-xs text-ink">{preview}</pre>
          </details>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" autoFocus onClick={onDecline}>
            {APPROVAL_DECLINE_LABEL}
          </Button>
          <Button onClick={onApprove}>{APPROVAL_APPROVE_LABEL}</Button>
        </div>
      </div>
    </div>
  )
}
