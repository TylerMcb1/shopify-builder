import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  CircleCheck,
  ExternalLink,
  FileCode2,
  Laptop,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import type { SessionEvent } from '../../shared/contracts/session.ts'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { Card, Note } from '../components/Card.tsx'
import { inputClass } from '../components/Field.tsx'
import { Markdown } from '../components/Markdown.tsx'
import { Segmented } from '../components/Segmented.tsx'

type Ready = Extract<SessionEvent, { type: 'step_ready' }>
type Blocked = Extract<SessionEvent, { type: 'validation_blocked' }>
type Sent = { after: number; text: string; key: number }
type Item =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'claude'; key: string; text: string }
  | { kind: 'question'; key: string; event: Extract<SessionEvent, { type: 'question' }> }
  | { kind: 'step'; key: string; step: Ready }
  | { kind: 'blocked'; key: string; event: Blocked }
  | { kind: 'failed'; key: string; message: string; ended: boolean }
  | { kind: 'notice'; key: string; text: string }

export type SaveOutcome = { message: string; status?: 'confirm' | 'saved' | 'blocked' | 'conflict' }
export type ActionOutcome = { ok: boolean; message: string }

export function ConversationPage({
  themeLabel,
  storeDomain,
  themeId,
  events,
  onSave,
  onDiscard,
  onUndo,
  onStartOver,
  onRetry,
  onUndoChange,
  onAnother,
  onSend,
  onAnswer,
}: {
  themeLabel: string
  storeDomain: string
  themeId: number
  events: SessionEvent[]
  onSave: () => Promise<SaveOutcome>
  onDiscard: () => Promise<void>
  onUndo: () => Promise<ActionOutcome>
  onStartOver: () => Promise<ActionOutcome>
  onRetry: () => Promise<ActionOutcome>
  onUndoChange: (changeId: string) => Promise<string>
  onAnother: () => void
  onSend: (text: string) => Promise<string>
  onAnswer: (requestId: string, text: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [view, setView] = useState<'chat' | 'confirm' | 'saved'>('chat')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [shots, setShots] = useState<{ before?: string; after?: string }>({})
  const [saved, setSaved] = useState<{ name: string; title: string; changeId: string } | null>(null)
  const [sent, setSent] = useState<Sent[]>([])
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [pending, setPending] = useState<'undo' | 'retry' | 'startOver' | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const last = events.at(-1)
  const progress = [...events].reverse().find((event) => event.type === 'progress')
  const working = last?.type === 'progress'
  const question = [...events].reverse().find((event) => event.type === 'question')
  const preview = [...events].reverse().find((event) => event.type === 'preview_ready')
  const page = preview && preview.type === 'preview_ready' && preview.pages.length > 0 ? preview.pages[0]! : 'index'
  const previewThemeId =
    preview && preview.type === 'preview_ready' && preview.previewThemeId ? preview.previewThemeId : themeId

  // Undo removes the newest kept step; starting over removes all of them.
  const undone = useMemo(() => {
    const kept: number[] = []
    const gone = new Set<number>()
    for (const event of events) {
      if (event.type === 'step_ready') kept.push(event.seq)
      if (event.type === 'step_undone') {
        const seq = kept.pop()
        if (seq !== undefined) gone.add(seq)
      }
      if (event.type === 'steps_cleared') for (const seq of kept.splice(0)) gone.add(seq)
    }
    return gone
  }, [events])
  const steps = events.filter((event): event is Ready => event.type === 'step_ready' && !undone.has(event.seq))
  const latest = steps.at(-1)

  const timeline = useMemo<Item[]>(() => {
    const items: { order: number; item: Item }[] = []
    for (const event of events) {
      if (event.type === 'assistant')
        items.push({ order: event.seq, item: { kind: 'claude', key: `a${event.seq}`, text: event.text } })
      if (event.type === 'question')
        items.push({ order: event.seq, item: { kind: 'question', key: `q${event.seq}`, event } })
      if (event.type === 'step_ready')
        items.push({ order: event.seq, item: { kind: 'step', key: `s${event.seq}`, step: event } })
      if (event.type === 'validation_blocked')
        items.push({ order: event.seq, item: { kind: 'blocked', key: `b${event.seq}`, event } })
      if (event.type === 'error') {
        items.push({
          order: event.seq,
          item: { kind: 'failed', key: `e${event.seq}`, message: event.message, ended: event.code !== 'model' },
        })
      }
      if (event.type === 'step_undone' || event.type === 'steps_cleared') {
        items.push({ order: event.seq, item: { kind: 'notice', key: `n${event.seq}`, text: event.message } })
      }
    }
    for (const message of sent) {
      items.push({ order: message.after + 0.5, item: { kind: 'user', key: `u${message.key}`, text: message.text } })
    }
    return items.sort((a, b) => a.order - b.order).map((entry) => entry.item)
  }, [events, sent])
  const lastItem = timeline.at(-1)
  const ended = events.some((event) => event.type === 'error' && event.code !== 'model')

  async function act(kind: 'undo' | 'retry' | 'startOver', run: () => Promise<ActionOutcome>) {
    setPending(kind)
    const result = await run()
    setPending(null)
    setNote(result.ok ? '' : result.message)
    return result
  }

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
      setSaved({ name: savedEvent.themeName, title: savedEvent.title, changeId: savedEvent.changeId })
      setView('saved')
    }
    if (events.some((event) => event.type === 'drift_confirm')) setView('confirm')
  }, [events])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [timeline.length, working])

  function remember(text: string) {
    setSent((current) => [...current, { after: events.at(-1)?.seq ?? 0, text, key: current.length }])
  }

  async function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    remember(text)
    setNote(await onSend(text))
  }

  async function save() {
    setSaving(true)
    const result = await onSave()
    setSaving(false)
    if (result.status === 'conflict') {
      setConflict(result.message)
      setNote('')
      return
    }
    setNote(result.message)
  }

  async function startOver() {
    const result = await act('startOver', onStartOver)
    if (result.ok) {
      setConflict(null)
      setView('chat')
    } else {
      setNote(result.message)
    }
  }

  const openPreview = () => void window.shopifyBuilder?.openExternal(previewHref(storeDomain, previewThemeId))

  if (view === 'saved' && saved) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto px-8 pb-16">
        <div className="animate-in w-full max-w-md text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-subtle text-primary">
            <CircleCheck className="size-7" aria-hidden="true" />
          </span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.06em] text-primary">Saved</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">{saved.name}</h1>
          <p className="mt-2 text-[14px] text-muted">{saved.title}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Button size="lg" icon={<Sparkles aria-hidden="true" />} onClick={onAnother}>
              Make another change
            </Button>
            {storeDomain ? (
              <Button size="lg" variant="secondary" icon={<ExternalLink aria-hidden="true" />} onClick={openPreview}>
                Open preview
              </Button>
            ) : null}
          </div>
          <Button
            variant="ghost"
            className="mt-3"
            icon={<Undo2 aria-hidden="true" />}
            onClick={() => {
              void onUndoChange(saved.changeId).then(setNote)
            }}
          >
            Undo this change
          </Button>
          {note ? (
            <div className="mt-4">
              <Note>{note}</Note>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (view === 'confirm') {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-8 pb-12">
          <Button
            variant="ghost"
            className="-ml-2"
            icon={<ArrowLeft aria-hidden="true" />}
            onClick={() => setView('chat')}
          >
            Back to conversation
          </Button>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em] text-ink">{themeLabel}</h1>
                <Badge tone="neutral">Unpublished</Badge>
              </div>
              <p className="mt-1.5 text-[14px] text-muted">
                {note || 'Review this change, then save it to the theme.'}
              </p>
            </div>
            {conflict ? null : (
              <Button
                size="lg"
                disabled={saving || steps.length === 0}
                icon={saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                onClick={() => void save()}
              >
                Save to theme
              </Button>
            )}
          </header>
          {conflict ? (
            <div className="animate-in rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="flex gap-3">
                <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <p className="text-[14px] font-semibold text-ink">Someone else changed this theme</p>
                  <p className="mt-1 text-[13.5px] leading-6 text-muted">
                    {conflict} To be safe, nothing was saved. Load the latest version, then describe your change again.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 pl-[30px]">
                <Button
                  disabled={pending !== null}
                  icon={
                    pending === 'startOver' ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )
                  }
                  onClick={() => void startOver()}
                >
                  Start over with the latest version
                </Button>
                <Button variant="secondary" onClick={() => setView('chat')}>
                  Back to conversation
                </Button>
              </div>
            </div>
          ) : null}
          {steps.length > 0 ? (
            <div className="space-y-3">
              {steps.map((step) => (
                <StepCard key={step.seq} step={step} />
              ))}
            </div>
          ) : (
            <Card>
              <p>No steps yet. Go back and describe the change first.</p>
            </Card>
          )}
          {conflict ? null : (
            <Button variant="secondary" onClick={() => setView('chat')}>
              Keep editing
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-8 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-[19px] font-semibold tracking-[-0.015em] text-ink">{themeLabel}</h1>
              <Badge tone="neutral">Unpublished</Badge>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted" aria-live="polite">
              {working ? <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" /> : null}
              {working && progress && progress.type === 'progress' ? progress.label : 'Ready for your request.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void onDiscard()}>
              Discard
            </Button>
            <Button disabled={steps.length === 0} onClick={() => setView('confirm')}>
              Save to theme
            </Button>
          </div>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {timeline.length === 0 && !working ? (
              <div className="animate-in py-16 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                  <Sparkles className="size-6" aria-hidden="true" />
                </span>
                <p className="mt-4 text-[15px] font-semibold text-ink">What would you like to change?</p>
                <p className="mt-1 text-[13px] text-muted">
                  Describe it in plain words. Claude makes the change on this theme.
                </p>
              </div>
            ) : null}
            {timeline.map((item) => {
              if (item.kind === 'user')
                return (
                  <Bubble key={item.key} side="user">
                    {item.text}
                  </Bubble>
                )
              if (item.kind === 'claude')
                return (
                  <Bubble key={item.key} side="claude">
                    {item.text}
                  </Bubble>
                )
              if (item.kind === 'notice') {
                return (
                  <p
                    key={item.key}
                    className="animate-in flex items-center justify-center gap-1.5 text-center text-[12.5px] text-muted"
                  >
                    <Undo2 className="size-3.5" aria-hidden="true" />
                    {item.text}
                  </p>
                )
              }
              if (item.kind === 'blocked' || item.kind === 'failed') {
                const current = lastItem?.key === item.key && !working
                const stopped = item.kind === 'failed' && item.ended
                const canRetry = item.kind === 'blocked' ? Boolean(item.event.canRetry) : !stopped
                return (
                  <div key={item.key} className="animate-in rounded-2xl border border-line bg-surface p-4 shadow-card">
                    <div className="flex gap-3">
                      <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-warning" aria-hidden="true" />
                      <div>
                        <p className="text-[14px] font-semibold text-ink">
                          {stopped
                            ? 'The change assistant stopped'
                            : item.kind === 'failed'
                              ? "Claude couldn't finish that step"
                              : "That change didn't go through"}
                        </p>
                        <p className="mt-0.5 text-[13.5px] leading-6 text-muted">
                          {item.kind === 'blocked' ? item.event.message : `${item.message} Your theme hasn't changed.`}
                        </p>
                      </div>
                    </div>
                    {current ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-[30px]">
                        {stopped ? (
                          <Button icon={<Sparkles aria-hidden="true" />} onClick={onAnother}>
                            Start a new change
                          </Button>
                        ) : canRetry ? (
                          <Button
                            disabled={pending !== null}
                            icon={
                              pending === 'retry' ? (
                                <Loader2 className="animate-spin" aria-hidden="true" />
                              ) : (
                                <RotateCcw aria-hidden="true" />
                              )
                            }
                            onClick={() => void act('retry', onRetry)}
                          >
                            Try again
                          </Button>
                        ) : null}
                        {stopped ? null : (
                          <span className="text-[12.5px] text-muted">
                            {canRetry
                              ? 'Or describe the change a different way below.'
                              : 'Describe the change again below.'}
                          </span>
                        )}
                        {note ? <p className="w-full text-[12.5px] text-danger">{note}</p> : null}
                      </div>
                    ) : null}
                  </div>
                )
              }
              if (item.kind === 'step') {
                const isUndone = undone.has(item.step.seq)
                const canUndo = latest?.seq === item.step.seq && !working
                return (
                  <StepCard
                    key={item.key}
                    step={item.step}
                    undone={isUndone}
                    action={
                      canUndo ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending !== null}
                          icon={
                            pending === 'undo' ? (
                              <Loader2 className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Undo2 aria-hidden="true" />
                            )
                          }
                          onClick={() => void act('undo', onUndo)}
                        >
                          Undo this step
                        </Button>
                      ) : null
                    }
                  />
                )
              }
              const event = item.event
              const open = question?.seq === event.seq
              return (
                <form
                  key={item.key}
                  className="animate-in rounded-2xl border border-line bg-surface p-4 shadow-card"
                  onSubmit={(submit) => {
                    submit.preventDefault()
                    const answer = new FormData(submit.currentTarget).get('answer')
                    if (typeof answer === 'string' && answer.trim()) {
                      remember(answer.trim())
                      submit.currentTarget.reset()
                      void onAnswer(event.requestId, answer.trim())
                    }
                  }}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-primary">Claude asks</p>
                  <div className="mt-1 text-[14px] leading-6 text-ink">
                    <Markdown>{event.text}</Markdown>
                  </div>
                  {open ? (
                    <div className="mt-3 flex gap-2">
                      <input name="answer" autoFocus placeholder="Your answer" className={inputClass} />
                      <Button type="submit" className="h-9">
                        Send answer
                      </Button>
                    </div>
                  ) : null}
                </form>
              )
            })}
            {working ? (
              <div className="flex items-center gap-2 pl-1 text-[13px] text-muted">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="size-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-faint" />
                </span>
                {progress && progress.type === 'progress' ? progress.label : 'Working'}
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-line px-8 py-4">
          <form
            className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-4 shadow-card transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20"
            onSubmit={(submit) => {
              submit.preventDefault()
              void send()
            }}
          >
            <textarea
              value={draft}
              rows={1}
              onChange={(change) => setDraft(change.target.value)}
              onKeyDown={(key) => {
                if (key.key === 'Enter' && !key.shiftKey) {
                  key.preventDefault()
                  if (!question) void send()
                }
              }}
              disabled={ended}
              placeholder={
                ended
                  ? 'Start a new change to keep going'
                  : question
                    ? 'Answer Claude’s question above'
                    : 'Describe the change'
              }
              className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-6 text-ink outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={ended || Boolean(question) || !draft.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary transition-[background-color,opacity,transform] hover:bg-primary-hover active:scale-95 disabled:opacity-35"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          </form>
          {note && lastItem?.kind !== 'blocked' && lastItem?.kind !== 'failed' ? (
            <p className="mx-auto mt-2 max-w-2xl text-[12.5px] text-muted">{note}</p>
          ) : null}
        </div>
      </section>

      <aside className="hidden w-[22rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-sidebar/60 px-5 pb-6 lg:flex">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink">Preview</h2>
          <Segmented
            label="Viewport"
            value={viewport}
            onChange={setViewport}
            options={[
              { value: 'desktop', label: 'Desktop', icon: <Laptop aria-hidden="true" /> },
              { value: 'mobile', label: 'Mobile', icon: <Smartphone aria-hidden="true" /> },
            ]}
          />
        </div>
        <figure className="space-y-4">
          <Shot label="Before" src={shots.before} mobile={viewport === 'mobile'} />
          <Shot label="After" src={shots.after} mobile={viewport === 'mobile'} />
        </figure>
        {storeDomain ? (
          <Button variant="secondary" icon={<ExternalLink aria-hidden="true" />} onClick={openPreview}>
            Open preview in browser
          </Button>
        ) : null}
        {latest && latest.warnings.length > 0 ? (
          <div className="rounded-xl bg-warning-subtle p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warning">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              Warnings
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] text-ink">
              {latest.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {latest && latest.files.length > 0 ? (
          <details className="group rounded-xl border border-line bg-surface text-[13px]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium text-ink">
              <FileCode2 className="size-4 text-muted" aria-hidden="true" />
              Show file changes
              <span className="ml-auto text-xs text-muted">{latest.files.length}</span>
            </summary>
            <ul className="space-y-1 border-t border-line px-3 py-2.5">
              {latest.files.map((file) => (
                <li key={file.path} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[12px] text-ink">{file.path}</span>
                  <Badge tone={file.status === 'added' ? 'ready' : 'neutral'}>{file.status}</Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </div>
  )
}

function Bubble({ side, children }: { side: 'user' | 'claude'; children: string }) {
  if (side === 'user') {
    return (
      <div className="animate-in flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] leading-6 text-on-primary">
          {children}
        </p>
      </div>
    )
  }
  return (
    <div className="animate-in flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <Sparkles className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-2.5 text-[14px] leading-6 text-ink shadow-card">
        <Markdown>{children}</Markdown>
      </div>
    </div>
  )
}

function StepCard({ step, undone = false, action }: { step: Ready; undone?: boolean; action?: ReactNode }) {
  return (
    <article
      className={`animate-in rounded-2xl border border-line bg-surface p-4 shadow-card ${undone ? 'opacity-55' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${undone ? 'text-muted' : 'text-primary'}`}
        >
          {undone ? (
            <Undo2 className="size-3.5" aria-hidden="true" />
          ) : (
            <CircleCheck className="size-3.5" aria-hidden="true" />
          )}
          {undone ? 'Undone' : 'Change made'}
        </p>
        {action}
      </div>
      <div className={`mt-1.5 text-[14px] leading-6 text-ink ${undone ? 'line-through decoration-faint' : ''}`}>
        <Markdown>{step.summary}</Markdown>
      </div>
      {step.files.length > 0 && !undone ? (
        <p className="mt-2 text-[12px] text-muted">
          {step.files.length} file{step.files.length === 1 ? '' : 's'} changed
        </p>
      ) : null}
      {step.sensitiveApproved.length > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          Important files changed with approval: {step.sensitiveApproved.join(', ')}
        </p>
      ) : null}
    </article>
  )
}

function Shot({ label, src, mobile }: { label: string; src?: string; mobile: boolean }) {
  return (
    <div>
      <figcaption className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
        {label}
      </figcaption>
      <div
        className={`overflow-hidden rounded-xl border border-line bg-surface shadow-card ${mobile ? 'mx-auto w-40' : ''}`}
      >
        {src ? (
          <img src={src} alt={`${label} preview`} className="block w-full" />
        ) : (
          <div className={`flex items-center justify-center text-[12px] text-faint ${mobile ? 'h-72' : 'h-36'}`}>
            No preview yet
          </div>
        )}
      </div>
    </div>
  )
}

function previewHref(storeDomain: string, themeId: number): string {
  const url = new URL(`https://${storeDomain}/`)
  url.searchParams.set('preview_theme_id', String(themeId))
  return url.toString()
}
