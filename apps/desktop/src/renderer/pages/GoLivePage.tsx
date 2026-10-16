import { useState } from 'react'
import { CircleCheck, CircleDashed, ExternalLink, GitMerge, ListChecks, Loader2, Plus, Rocket, Store } from 'lucide-react'
import type { GoLiveView } from '../../shared/contracts/account.ts'
import { Button } from '../components/Button.tsx'
import { Card, Note, PageHeader } from '../components/Card.tsx'
import { Field } from '../components/Field.tsx'

export function GoLivePage({
  notice,
  rollbackLabel,
  retiredThemeId,
  onStartCopy,
}: {
  notice: string | null
  rollbackLabel: string | null
  retiredThemeId: number | null
  onStartCopy: (themeId: number) => Promise<string>
}) {
  const bridge = window.shopifyBuilder
  const [themeId, setThemeId] = useState('')
  const [view, setView] = useState<GoLiveView | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function check() {
    if (!bridge || !themeId) return
    setBusy(true)
    setView(await bridge.checkGoLive(Number(themeId)))
    setBusy(false)
    setNote('')
  }

  async function apply(choice: 'live' | 'working') {
    if (!bridge || !themeId) return
    setBusy(true)
    const result = await bridge.applyGoLive(Number(themeId), choice)
    setNote(result.message ?? '')
    setView(await bridge.checkGoLive(Number(themeId)))
    setBusy(false)
  }

  const passed = view ? view.items.filter((item) => item.passed).length : 0

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-8 pb-12">
      <PageHeader
        title="Get ready to go live"
        description="Shopify Builder checks this working copy and tells you what to do in Shopify admin. It does not change which theme customers see."
      />

      {notice ? (
        <Card title={notice} icon={<Rocket />} description={rollbackLabel ?? undefined}>
          {retiredThemeId ? (
            <Button
              icon={<Plus aria-hidden="true" />}
              onClick={() => {
                void onStartCopy(retiredThemeId).then(setNote)
              }}
            >
              Start a new working copy
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Card title="Working copy" icon={<ListChecks />} description="Enter the theme id of the working copy you want to check.">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void check()
          }}
        >
          <div className="w-56">
            <Field
              id="golive-theme-id"
              label="Theme id"
              placeholder="123456789012"
              inputMode="numeric"
              value={themeId}
              onChange={(event) => setThemeId(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          <Button
            type="submit"
            className="h-9"
            disabled={!themeId || busy}
            icon={busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          >
            Check this theme
          </Button>
        </form>
      </Card>

      {note ? <Note>{note}</Note> : null}

      {view ? (
        <div className="animate-in space-y-6">
          <Card
            title="Checklist"
            description={`${passed} of ${view.items.length} checks passed`}
            icon={<CircleCheck />}
          >
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas">
              {view.items.map((item) => (
                <li key={item.id} className="flex gap-3 px-3.5 py-3">
                  {item.passed ? (
                    <CircleCheck className="mt-0.5 size-[18px] shrink-0 text-primary" aria-label="Passed" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-[18px] shrink-0 text-warning" aria-label="Needs attention" />
                  )}
                  <div>
                    <p className="text-[13.5px] font-medium text-ink">{item.label}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {view.liveFiles.length > 0 || view.conflicts.length > 0 ? (
            <Card
              title="Live theme changes"
              icon={<GitMerge />}
              description={
                view.conflicts.length > 0
                  ? 'Some files changed in both places. Choose which version to keep.'
                  : 'These files changed on the live theme since this copy was made.'
              }
            >
              <ul className="space-y-1 rounded-xl border border-line bg-canvas px-3.5 py-2.5">
                {view.conflicts.map((file) => (
                  <li key={`c-${file}`} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12px] text-ink">{file}</span>
                    <span className="text-[11.5px] font-medium text-warning">Changed in both</span>
                  </li>
                ))}
                {view.liveFiles.map((file) => (
                  <li key={`l-${file}`} className="truncate font-mono text-[12px] text-ink">
                    {file}
                  </li>
                ))}
              </ul>
              {view.conflicts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void apply('live')}>
                    Keep the live store's version of these files
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void apply('working')}>
                    Keep my working copy's version
                  </Button>
                </div>
              ) : (
                <Button disabled={busy} icon={<GitMerge aria-hidden="true" />} onClick={() => void apply('live')}>
                  Bring in live changes
                </Button>
              )}
            </Card>
          ) : null}

          {view.instructions.length > 0 ? (
            <Card title="In Shopify admin" icon={<Store />} description="You make the theme live yourself, in Shopify.">
              <ol className="space-y-2.5">
                {view.instructions.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[12px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-[13.5px] text-ink">{step}</span>
                  </li>
                ))}
              </ol>
              {view.themesUrl ? (
                <Button
                  variant="secondary"
                  icon={<ExternalLink aria-hidden="true" />}
                  onClick={() => void bridge?.openExternal(view.themesUrl ?? '')}
                >
                  Open Shopify Themes page
                </Button>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
