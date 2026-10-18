import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Container,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Store,
} from 'lucide-react'
import type { SetupStatus } from '../../shared/contracts/setup.ts'
import { EXTERNAL_LINKS } from '../../shared/security/links.ts'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { Card, Note, PageHeader } from '../components/Card.tsx'
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

export function SetupPage({
  onStarted,
  notice,
}: {
  onStarted: (session: { sessionId: string; storeDomain: string; themeId: number; themeLabel: string }) => void
  notice: string | null
}) {
  const bridge = window.shopifyBuilder
  const queryClient = useQueryClient()
  const [linkError, setLinkError] = useState('')
  const [domain, setDomain] = useState('')
  const [themeId, setThemeId] = useState('')
  const [storeNote, setStoreNote] = useState('')
  const [keyNote, setKeyNote] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [canSaveKey, setCanSaveKey] = useState(false)
  const [canSavePassword, setCanSavePassword] = useState(false)
  const [replacingKey, setReplacingKey] = useState(false)
  const [busy, setBusy] = useState<'key' | 'store' | 'pull' | 'start' | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const statusQuery = useQuery({
    queryKey: ['setup'],
    queryFn: () => {
      if (!bridge) throw new Error('missing bridge')
      return bridge.getSetupStatus()
    },
    enabled: Boolean(bridge),
    refetchInterval: (query) => (query.state.data?.images.status === 'downloading' ? 3000 : false),
  })
  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: () => {
      if (!bridge) throw new Error('missing bridge')
      return bridge.credentialStatus()
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
  const account = accountQuery.data
  const pending = Boolean(bridge) && (statusQuery.isPending || retry.isPending)
  const dockerReady = status?.docker.state === 'ready'
  const savedDomain = account?.storeDomain ?? ''
  const ready = Boolean(account?.claudeConnected && savedDomain && dockerReady)

  useEffect(() => {
    if (savedDomain && !domain) setDomain(savedDomain)
  }, [savedDomain, domain])

  async function open(url: string) {
    if (!bridge) return
    const result = await bridge.openExternal(url)
    setLinkError(result.ok ? '' : result.message)
  }

  async function saveKey() {
    if (!bridge) return
    const value = keyRef.current?.value ?? ''
    if (keyRef.current) keyRef.current.value = ''
    setCanSaveKey(false)
    setBusy('key')
    const result = await bridge.saveKey(value)
    setBusy(null)
    setKeyNote(result.message ?? '')
    setReplacingKey(false)
    await queryClient.invalidateQueries({ queryKey: ['account'] })
  }

  async function saveStore() {
    if (!bridge) return
    const password = passwordRef.current?.value ?? ''
    if (passwordRef.current) passwordRef.current.value = ''
    setCanSavePassword(false)
    setBusy('store')
    const result = await bridge.connectStore(domain, password)
    setBusy(null)
    setStoreNote(result.message ?? '')
    await queryClient.invalidateQueries({ queryKey: ['account'] })
  }

  async function pull() {
    if (!bridge) return
    setBusy('pull')
    const result = await bridge.pullTheme(domain, Number(themeId))
    setBusy(null)
    setChangeNote(result.message ?? '')
  }

  async function start() {
    if (!bridge) return
    setBusy('start')
    const result = await bridge.startSession({ storeId: domain.split('.')[0] ?? '', themeId: Number(themeId), storeDomain: domain })
    setBusy(null)
    if (result.ok && result.sessionId) {
      onStarted({ sessionId: result.sessionId, storeDomain: domain, themeId: Number(themeId), themeLabel: domain })
      return
    }
    setChangeNote(result.message ?? '')
  }

  const spinner = <Loader2 className="animate-spin" aria-hidden="true" />

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-8 pb-12">
      <PageHeader
        eyebrow={ready ? 'Ready' : 'Setup'}
        title={ready ? 'Home' : 'Set up this computer'}
        description="Docker Desktop is the only thing that needs to be running. Connecting Claude and your store is on this screen."
      />
      {notice ? <Note tone="warning">{notice}</Note> : null}

      <Card
        title="Docker Desktop"
        description={dockerMessage(pending, Boolean(bridge), status)}
        icon={dockerReady ? <CircleCheck /> : <CircleAlert />}
        action={
          <Button
            variant={dockerReady ? 'secondary' : 'primary'}
            disabled={!bridge || pending}
            icon={pending ? spinner : <RefreshCw aria-hidden="true" />}
            onClick={() => retry.mutate()}
          >
            Retry
          </Button>
        }
      >
        <div aria-live="polite">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
            <Container className="size-3.5" aria-hidden="true" />
            Tools
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas">
            {(status?.images.images ?? placeholderImages()).map((image) => (
              <li key={image.name} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-[13px]">
                <span className="font-medium text-ink">{LABELS[image.name]}</span>
                <span className="flex items-center gap-3">
                  {image.message !== badgeLabel(image.status) ? <span className="text-muted">{image.message}</span> : null}
                  <Badge tone={TONES[image.status]}>{badgeLabel(image.status)}</Badge>
                </span>
              </li>
            ))}
          </ul>
          {status ? <p className="mt-2 text-xs text-muted">{status.images.message}</p> : null}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Connect Claude"
          description="An Anthropic API key lets Shopify Builder talk to Claude. The key stays on this computer."
          icon={<KeyRound />}
          action={account?.claudeConnected ? <Badge tone="ready">Connected</Badge> : null}
        >
          {account?.claudeConnected && !replacingKey ? (
            <>
              <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">Claude connected</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {account.claudeLast4 ? `sk-ant-••••${account.claudeLast4}` : 'Key saved'}
                  </p>
                </div>
                <CircleCheck className="size-5 text-primary" aria-hidden="true" />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setReplacingKey(true)}>
                  Replace key
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!bridge) return
                    void bridge.removeKey().then(async (result) => {
                      setKeyNote(result.message ?? '')
                      await queryClient.invalidateQueries({ queryKey: ['account'] })
                    })
                  }}
                >
                  Remove key
                </Button>
              </div>
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (canSaveKey) void saveKey()
              }}
            >
              {account?.claudeLocked ? (
                <Note tone="warning">Enter your API key again. This computer could not unlock the saved key.</Note>
              ) : null}
              <Field
                id="anthropic-key"
                ref={keyRef}
                label="API key"
                placeholder="sk-ant-…"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                onInput={() => setCanSaveKey(Boolean(keyRef.current?.value))}
                trailing={<RevealButton shown={showKey} onToggle={() => setShowKey((current) => !current)} />}
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={!bridge || !canSaveKey || busy === 'key'} icon={busy === 'key' ? spinner : null}>
                  Save
                </Button>
                {replacingKey ? (
                  <Button variant="secondary" onClick={() => setReplacingKey(false)}>
                    Cancel
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  className="ml-auto"
                  icon={<ArrowUpRight aria-hidden="true" />}
                  onClick={() => void open(EXTERNAL_LINKS.anthropicConsole)}
                >
                  Get an API key
                </Button>
              </div>
            </form>
          )}
          {keyNote ? <Note>{keyNote}</Note> : null}
        </Card>

        <Card
          title="Connect your store"
          description="A Theme Access password lets Shopify Builder read and prepare themes. It cannot make a theme live."
          icon={<Store />}
          action={savedDomain ? <Badge tone="ready">Connected</Badge> : null}
        >
          {savedDomain && account?.storeDomain ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">Store connected</p>
                <p className="mt-0.5 truncate text-xs text-muted">{account.storeDomain}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!bridge) return
                  void bridge.disconnectStore().then(async (result) => {
                    setStoreNote(result.message ?? '')
                    setDomain('')
                    await queryClient.invalidateQueries({ queryKey: ['account'] })
                  })
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (domain && canSavePassword) void saveStore()
              }}
            >
              <Field
                id="store-domain"
                label="Store domain"
                placeholder="your-store.myshopify.com"
                value={domain}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setDomain(event.target.value.trim())}
              />
              <Field
                id="theme-password"
                ref={passwordRef}
                label="Theme Access password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                onInput={() => setCanSavePassword(Boolean(passwordRef.current?.value))}
                trailing={<RevealButton shown={showPassword} onToggle={() => setShowPassword((current) => !current)} />}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={!bridge || !domain || !canSavePassword || busy === 'store'}
                  icon={busy === 'store' ? spinner : null}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  className="ml-auto"
                  icon={<ArrowUpRight aria-hidden="true" />}
                  onClick={() => void open(EXTERNAL_LINKS.themeAccessHelp)}
                >
                  How Theme Access passwords work
                </Button>
              </div>
            </form>
          )}
          {storeNote ? <Note>{storeNote}</Note> : null}
          <p className="text-xs text-faint">The password is encrypted. It is not saved on disk as plain text.</p>
        </Card>
      </div>

      <Card
        title="Make a change"
        description="Pull an unpublished theme, then describe the change. The theme has to be pulled before a change can start."
        icon={<Sparkles />}
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (domain && themeId) void start()
          }}
        >
          <div className="w-56">
            <Field
              id="theme-id"
              label="Theme id"
              placeholder="123456789012"
              inputMode="numeric"
              value={themeId}
              onChange={(event) => setThemeId(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          <Button
            variant="secondary"
            className="h-9"
            disabled={!bridge || !domain || !themeId || busy !== null}
            icon={busy === 'pull' ? spinner : <Download aria-hidden="true" />}
            onClick={() => void pull()}
          >
            Pull theme
          </Button>
          <Button
            type="submit"
            className="h-9"
            disabled={!bridge || !domain || !themeId || busy !== null}
            icon={busy === 'start' ? spinner : <Sparkles aria-hidden="true" />}
          >
            Start a change
          </Button>
        </form>
        {changeNote ? <Note>{changeNote}</Note> : null}
      </Card>
      {linkError ? <Note tone="danger">{linkError}</Note> : null}
    </div>
  )
}

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide' : 'Show'}
      className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-control hover:text-ink"
    >
      {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
    </button>
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
