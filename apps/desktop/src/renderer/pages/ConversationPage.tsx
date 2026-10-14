import { useEffect, useState } from 'react'
import type { SessionEvent } from '../../shared/contracts/session.ts'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'

type Ready = Extract<SessionEvent, { type: 'step_ready' }>

export function ConversationPage({
  themeLabel,
  storeDomain,
  themeId,
  events,
  onSave,
  onDiscard,
  onUndo,
  onRedo,
  onSend,
  onAnswer,
}: {
  themeLabel: string
  storeDomain: string
  themeId: number
  events: SessionEvent[]
  onSave: () => Promise<string>
  onDiscard: () => Promise<void>
  onUndo: () => Promise<void>
  onRedo: () => Promise<void>
  onSend: (text: string) => Promise<string>
  onAnswer: (requestId: string, text: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [view, setView] = useState<'chat' | 'confirm' | 'saved'>('chat')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [shots, setShots] = useState<{ before?: string; after?: string }>({})
  const [saved, setSaved] = useState<{ name: string; title: string } | null>(null)

  const progress = [...events].reverse().find((event) => event.type === 'progress')
  const question = [...events].reverse().find((event) => event.type === 'question')
  const blocked = [...events].reverse().find((event) => event.type === 'validation_blocked')
  const steps = events.filter((event): event is Extract<SessionEvent, { type: 'step_ready' }> => event.type === 'step_ready')
  const latest = steps.at(-1)
  const preview = [...events].reverse().find((event) => event.type === 'preview_ready')
  const page = preview && preview.type === 'preview_ready' && preview.pages.length > 0 ? preview.pages[0]! : 'index'
  const previewThemeId = preview && preview.type === 'preview_ready' && preview.previewThemeId ? preview.previewThemeId : themeId

  useEffect(() => {
    const bridge = window.shopifyBuilder
    if (!bridge || !preview) return
    let cancel = false
    void (async () => {
      const [before, after] = await Promise.all([
        bridge.readShot(page, viewport, 'before'),
        bridge.readShot(page, viewport, 'after'),
      ])
      if (cancel) return
      setShots({
        before: before.ok ? before.dataUrl : undefined,
        after: after.ok ? after.dataUrl : undefined,
      })
    })()
    return () => {
      cancel = true
    }
  }, [preview, page, viewport])

  useEffect(() => {
    const savedEvent = [...events].reverse().find((event) => event.type === 'saved')
    if (savedEvent && savedEvent.type === 'saved') {
      setSaved({ name: savedEvent.themeName, title: savedEvent.title })
      setView('saved')
    }
    if (events.some((event) => event.type === 'drift_confirm')) setView('confirm')
  }, [events])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setNote(await onSend(text))
  }

  if (view === 'saved' && saved) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-8 py-12">
        <p className="text-sm font-medium text-primary">Saved</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{saved.name}</h1>
        <p className="mt-3 text-muted">{saved.title}</p>
        <div className="mt-6 flex gap-3">
          {storeDomain ? (
            <Button variant="secondary" onClick={() => void window.shopifyBuilder?.openExternal(previewHref(storeDomain, previewThemeId))}>
              Open preview
            </Button>
          ) : null}
        </div>
      </main>
    )
  }

  if (view === 'confirm') {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-8 py-12">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{themeLabel}</h1>
          <Badge tone="neutral">Unpublished</Badge>
        </div>
        <p className="mt-4 text-muted">{note || 'Review this change, then save it to the theme.'}</p>
        <StepList steps={steps} />
        <div className="mt-6 flex gap-3">
          <Button
            onClick={() =>
              void onSave().then((message) => {
                setNote(message)
              })
            }
          >
            Save to theme
          </Button>
          <Button variant="secondary" onClick={() => setView('chat')}>
            Back to conversation
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl gap-6 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">{themeLabel}</h1>
            <Badge tone="neutral">Unpublished</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setView('confirm')}>
              Save to theme
            </Button>
            <Button variant="ghost" onClick={() => void onDiscard()}>
              Discard
            </Button>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          {progress && progress.type === 'progress' ? progress.label : 'Ready for your request.'}
        </p>
        <div className="mt-4 space-y-3">
          {events
            .filter((event) => event.type === 'assistant' || event.type === 'question')
            .map((event) =>
              event.type === 'assistant' ? (
                <p key={event.seq} className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink">
                  <span className="font-medium">Claude: </span>
                  {event.text}
                </p>
              ) : (
                <form
                  key={event.seq}
                  className="rounded-lg border border-line bg-surface p-3"
                  onSubmit={(submit) => {
                    submit.preventDefault()
                    const answer = new FormData(submit.currentTarget).get('answer')
                    if (typeof answer === 'string' && answer.trim()) void onAnswer(event.requestId, answer.trim())
                  }}
                >
                  <p className="text-sm text-ink">{event.text}</p>
                  <input name="answer" className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm" />
                  <Button className="mt-2" type="submit">Send answer</Button>
                </form>
              ),
            )}
          <StepList steps={steps} />
          {blocked && blocked.type === 'validation_blocked' ? (
            <div className="rounded-lg border border-line bg-surface p-3 text-sm">
              <p className="text-ink">{blocked.message}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => void onUndo()}>
                  Undo this step
                </Button>
                <Button variant="ghost" onClick={() => void onRedo()}>
                  Redo on the latest version
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(submit) => {
            submit.preventDefault()
            void send()
          }}
        >
          <input
            value={draft}
            onChange={(change) => setDraft(change.target.value)}
            placeholder="Describe the change"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
          <Button type="submit" disabled={Boolean(question)}>Send</Button>
        </form>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        {latest ? (
          <p className="mt-3 text-sm">
            <Button variant="ghost" className="px-0" onClick={() => void onUndo()}>
              Undo this step
            </Button>
          </p>
        ) : null}
      </section>
      <aside className="rounded-xl border border-line bg-surface p-4">
        <div className="flex gap-2">
          <Button variant={viewport === 'desktop' ? 'primary' : 'secondary'} onClick={() => setViewport('desktop')}>
            Desktop
          </Button>
          <Button variant={viewport === 'mobile' ? 'primary' : 'secondary'} onClick={() => setViewport('mobile')}>
            Mobile
          </Button>
        </div>
        <figure className="mt-4 space-y-3">
          <Shot label="Before" src={shots.before} />
          <Shot label="After" src={shots.after} />
        </figure>
        {storeDomain ? (
          <Button variant="secondary" className="mt-4" onClick={() => void window.shopifyBuilder?.openExternal(previewHref(storeDomain, previewThemeId))}>
            Open preview in browser
          </Button>
        ) : null}
        {latest && latest.warnings.length > 0 ? (
          <ul className="mt-4 list-disc pl-5 text-sm text-muted">
            {latest.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {latest && latest.files.length > 0 ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-primary">Show file changes</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {latest.files.map((file) => (
                <li key={file.path}>
                  {file.path} ({file.status})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </main>
  )
}

function StepList({ steps }: { steps: Ready[] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <article key={step.seq} className="rounded-lg border border-line bg-surface p-3 text-sm">
          <p className="font-medium text-ink">Claude's description</p>
          <p className="mt-1 text-ink">{step.summary}</p>
          {step.sensitiveApproved.length > 0 ? (
            <p className="mt-2 text-muted">Important files changed with approval: {step.sensitiveApproved.join(', ')}</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function Shot({ label, src }: { label: string; src?: string }) {
  return (
    <div>
      <figcaption className="text-xs font-medium text-muted">{label}</figcaption>
      {src ? <img src={src} alt="" className="mt-1 w-full rounded-lg border border-line" /> : <div className="mt-1 h-24 rounded-lg bg-canvas" />}
    </div>
  )
}

function previewHref(storeDomain: string, themeId: number): string {
  const url = new URL(`https://${storeDomain}/`)
  url.searchParams.set('preview_theme_id', String(themeId))
  return url.toString()
}
