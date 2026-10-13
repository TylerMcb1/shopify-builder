import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { SetupStatus } from '../../shared/contracts/setup.ts'
import { EXTERNAL_LINKS } from '../../shared/security/links.ts'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { Card } from '../components/Card.tsx'
import { Field } from '../components/Field.tsx'

const LABELS = {
  base: 'Shared runtime',
  agent: 'Change assistant',
  shopify: 'Shopify tools',
  gateway: 'Claude connection',
} as const

const TONES = {
  match: 'ready',
  unpinned: 'warning',
  missing: 'danger',
  mismatch: 'danger',
} as const

export function SetupPage() {
  const bridge = window.shopifyBuilder
  const queryClient = useQueryClient()
  const [linkError, setLinkError] = useState('')
  const statusQuery = useQuery({
    queryKey: ['setup'],
    queryFn: () => {
      if (!bridge) throw new Error('missing bridge')
      return bridge.getSetupStatus()
    },
    enabled: Boolean(bridge),
  })
  const retry = useMutation({
    mutationFn: () => {
      if (!bridge) throw new Error('missing bridge')
      return bridge.retryDocker()
    },
    onSuccess: (status) => queryClient.setQueryData(['setup'], status),
  })

  const status = statusQuery.data
  const pending = Boolean(bridge) && (statusQuery.isPending || retry.isPending)
  const dockerReady = status?.docker.state === 'ready'

  async function open(url: string) {
    if (!bridge) return
    const result = await bridge.openExternal(url)
    setLinkError(result.ok ? '' : result.message)
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-8 py-12">
      <header className="mb-8">
        <p className="text-sm font-medium text-primary">Shopify Builder</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Set up this computer</h1>
        <p className="mt-3 max-w-xl text-base leading-6 text-muted">
          Docker Desktop is the only thing that needs to be running. Connecting Claude and your store is on this screen.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-6" aria-live="polite">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {dockerReady ? (
              <CircleCheck className="mt-0.5 text-primary" aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 text-warning" aria-hidden="true" />
            )}
            <div>
              <h2 className="text-base font-semibold text-ink">Docker Desktop</h2>
              <p className="mt-1 text-sm text-muted">{dockerMessage(pending, Boolean(bridge), status)}</p>
            </div>
          </div>
          <Button
            variant={dockerReady ? 'secondary' : 'primary'}
            disabled={!bridge || pending}
            onClick={() => retry.mutate()}
          >
            Retry
          </Button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-muted">Tools</h2>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
          {(status?.images.images ?? placeholderImages()).map((image) => (
            <li key={image.name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="font-medium text-ink">{LABELS[image.name]}</span>
              <span className="flex items-center gap-3 text-muted">
                {image.message}
                <Badge tone={TONES[image.status]}>{badgeLabel(image.status)}</Badge>
              </span>
            </li>
          ))}
        </ul>
        {status ? <p className="mt-2 text-sm text-muted">{status.images.message}</p> : null}
      </section>

      <div className="mt-8 grid gap-4">
        <Card title="Connect Claude">
          <p>An Anthropic API key lets Shopify Builder talk to Claude. The key stays on this computer.</p>
          <Button variant="ghost" className="px-0" onClick={() => void open(EXTERNAL_LINKS.anthropicConsole)}>
            Get an API key
          </Button>
          <Field id="anthropic-key" label="API key" type="password" disabled autoComplete="off" />
          <Button disabled>Save</Button>
          <p>Saving a key is not available yet.</p>
        </Card>

        <Card title="Connect your store">
          <p>A Theme Access password lets Shopify Builder read and prepare themes. It cannot make a theme live.</p>
          <Button variant="ghost" className="px-0" onClick={() => void open(EXTERNAL_LINKS.themeAccessHelp)}>
            How Theme Access passwords work
          </Button>
          <Field id="store-domain" label="Store domain" disabled placeholder="your-store.myshopify.com" />
          <Field id="theme-password" label="Theme Access password" type="password" disabled autoComplete="off" />
          <Button disabled>Save</Button>
          <p>Saving a store connection is not available yet.</p>
        </Card>
      </div>
      {linkError ? <p className="mt-4 text-sm text-danger">{linkError}</p> : null}
    </main>
  )
}

function dockerMessage(pending: boolean, hasBridge: boolean, status: SetupStatus | undefined): string {
  if (!hasBridge) return 'Open this screen in the Shopify Builder app to check Docker Desktop.'
  if (pending && !status) return 'Checking Docker Desktop…'
  return status?.docker.message ?? 'Couldn’t check Docker Desktop. Click Retry.'
}

function placeholderImages(): SetupStatus['images']['images'] {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[]).map((name) => ({
    name,
    ref: '',
    status: 'missing',
    message: 'Not checked',
  }))
}

function badgeLabel(status: SetupStatus['images']['images'][number]['status']): string {
  if (status === 'match') return 'Ready'
  if (status === 'unpinned') return 'Not locked'
  if (status === 'mismatch') return 'Wrong version'
  return 'Missing'
}
