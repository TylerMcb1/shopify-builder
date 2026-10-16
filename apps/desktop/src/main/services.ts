// Main-process credential, history, go-live, and update actions (README 7, 8.6, 8.7, 15, 21).
import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { isThemePath, type SessionCommandResult } from '../../../../packages/host/src/agent/protocol.ts'
import { startGateway, type GatewayHandle } from '../../../../packages/host/src/agent/gateway.ts'
import { GO_LIVE_STEPS, undoConflictMessage } from '../../../../packages/host/src/change/copy.ts'
import { detectRoleChanges, goLiveChecklist } from '../../../../packages/host/src/change/golive.ts'
import { CHANGE_MESSAGES } from '../../../../packages/host/src/change/messages.ts'
import { CREDENTIAL_MESSAGES } from '../../../../packages/host/src/credentials/messages.ts'
import { openSecretStore, type SecretCodec } from '../../../../packages/host/src/credentials/secrets.ts'
import { verifyAnthropicKey } from '../../../../packages/host/src/credentials/verify.ts'
import { HostError } from '../../../../packages/host/src/errors.ts'
import { createGit } from '../../../../packages/host/src/git/git.ts'
import { SHOPIFY_REF } from '../../../../packages/host/src/git/history.ts'
import { createHistoryService } from '../../../../packages/host/src/git/history.ts'
import { createSessionHistory, shortTitle } from '../../../../packages/host/src/git/session.ts'
import { openChats } from '../../../../packages/host/src/history/chats.ts'
import { chatExpired, chatExpiryNotice, todayUtc } from '../../../../packages/host/src/history/retention.ts'
import { pagesToCapture, type PreviewPage } from '../../../../packages/host/src/preview/url.ts'
import { openRecords } from '../../../../packages/host/src/records/store.ts'
import { createWriteGateway } from '../../../../packages/host/src/shopify/gateway.ts'
import { createShopifyReadService } from '../../../../packages/host/src/shopify/read-service.ts'
import { createShopifyRunner } from '../../../../packages/host/src/shopify/runner.ts'
import { themePaths } from '../../../../packages/host/src/store/layout.ts'
import { filesToTakeFromLive, hashTheme, listThemeFiles, planFileMerge } from '../../../../packages/host/src/theme/files.ts'
import { updateDecision } from '../../../../packages/host/src/updates/policy.ts'
import { compareThemeCheck } from '../../../../packages/host/src/validation/theme-check.ts'
import type { ChatOpen, CredentialStatus, GoLiveView, HistoryView, RoleNotice, UpdateStatus } from '../shared/contracts/account.ts'

const COMMIT = /^[0-9a-f]{40,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// HostError details are redacted at the source; only the main-process console sees them.
function logFailure(action: string, err: unknown): void {
  const detail = err instanceof HostError ? `${err.code}: ${err.detail ?? ''}` : err instanceof Error ? err.message : String(err)
  console.error(`[shopify-builder] ${action} failed: ${detail.slice(0, 2000)}`)
}

export function createAppServices(opts: {
  userDataDir: string
  shopifyImage: string
  gatewayImage: string
  codec: SecretCodec
  version: string
  capture?: (pages: PreviewPage[], dir: string, when: 'before' | 'after') => Promise<void>
}) {
  const secrets = openSecretStore(opts.userDataDir, opts.codec)
  const chats = () => openChats(opts.userDataDir)
  let gateway: GatewayHandle | null = null
  let busy = () => false

  const clip = (message: string) => (message.length > 400 ? `${message.slice(0, 397)}...` : message)
  const fail = (message: string): SessionCommandResult => ({ ok: false, message: clip(message) })

  const storeDomain = () => chats().getSetting('store_domain')
  const storeIdOf = (domain: string) => domain.split('.')[0] ?? ''

  async function getThemeToken(): Promise<string> {
    const token = secrets.load('shopify')
    if (!token) {
      throw new HostError('invalid-input', secrets.locked('shopify') ? CREDENTIAL_MESSAGES.decryptFailed : CHANGE_MESSAGES.connectStore)
    }
    return token
  }

  function shopify(domain: string) {
    const storeId = storeIdOf(domain)
    const records = openRecords(opts.userDataDir)
    const read = createShopifyReadService({
      userDataDir: opts.userDataDir,
      storeId,
      storeDomain: domain,
      image: opts.shopifyImage,
      getThemeToken,
    })
    const runner = createShopifyRunner({ image: opts.shopifyImage, getThemeToken })
    const gateway = createWriteGateway({
      storeId,
      storeDomain: domain,
      records,
      listThemes: () => read.listThemes(),
      runPush: (args, dir) => runner.push(args, dir),
    })
    return { storeId, records, read, runner, gateway }
  }

  async function stopGateway() {
    const current = gateway
    gateway = null
    await current?.stop().catch(() => {})
  }

  async function prepareAgent(): Promise<SessionCommandResult> {
    if (gateway) return { ok: true }
    if (secrets.locked('anthropic')) return fail(CREDENTIAL_MESSAGES.decryptFailed)
    if (!secrets.has('anthropic')) return fail(CREDENTIAL_MESSAGES.connectClaude)
    try {
      gateway = await startGateway({
        image: opts.gatewayImage,
        getSecret: async () => {
          const key = secrets.load('anthropic')
          if (!key) throw new Error('missing key')
          return key
        },
      })
      return { ok: true }
    } catch (err) {
      gateway = null
      return fail(err instanceof HostError ? err.userMessage : CREDENTIAL_MESSAGES.connectClaude)
    }
  }

  async function applyRetention() {
    const today = todayUtc()
    const store = chats()
    for (const id of store.applyRetention(today)) {
      await rm(path.join(opts.userDataDir, 'chats', id), { recursive: true, force: true }).catch(() => {})
    }
    const raw = store.getSetting('open_session')
    if (!raw) return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      const record = parsed as { activeDay?: unknown; sessionDir?: unknown }
      if (typeof record.activeDay !== 'string' || typeof record.sessionDir !== 'string') return
      if (!chatExpired(record.activeDay, today)) return
      const sessionDir = path.resolve(record.sessionDir)
      if (sessionDir.startsWith(path.resolve(opts.userDataDir) + path.sep)) await rm(sessionDir, { recursive: true, force: true })
      store.clearSetting('open_session')
    } catch {
      store.clearSetting('open_session')
    }
  }

  function notice(): string | null {
    const today = todayUtc()
    const store = chats()
    if (store.listChats().some((chat) => chatExpiryNotice(chat.activeDay, today))) {
      return 'Some chats will be deleted in the next few days.'
    }
    const raw = store.getSetting('open_session')
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      const activeDay = parsed && typeof parsed === 'object' ? (parsed as { activeDay?: unknown }).activeDay : null
      if (typeof activeDay === 'string' && chatExpiryNotice(activeDay, today)) {
        return 'An open change will be discarded in the next few days.'
      }
    } catch {
      return null
    }
    return null
  }

  void applyRetention().catch(() => {})

  return {
    storeDomain,
    getThemeToken,
    prepareAgent,
    stopGateway,
    applyRetention,
    bindBusy(next: () => boolean) {
      busy = next
    },
    credentialStatus(): CredentialStatus {
      const last4 = chats().getSetting('anthropic_last4')
      const connected = secrets.has('anthropic') && !secrets.locked('anthropic')
      return {
        claudeConnected: connected,
        claudeLast4: connected && last4 && /^[A-Za-z0-9_-]{4}$/.test(last4) ? last4 : null,
        claudeLocked: secrets.locked('anthropic'),
        storeDomain: storeDomain(),
      }
    },
    async saveKey(key: string): Promise<SessionCommandResult> {
      const verdict = await verifyAnthropicKey(key)
      if (!verdict.ok) return fail(verdict.message)
      if (!secrets.available()) return fail(CREDENTIAL_MESSAGES.unavailable)
      secrets.save('anthropic', key)
      chats().setSetting('anthropic_last4', key.slice(-4))
      if (gateway) {
        await stopGateway()
        if (busy()) await prepareAgent()
      }
      return { ok: true, message: CREDENTIAL_MESSAGES.connected }
    },
    async removeKey(): Promise<SessionCommandResult> {
      secrets.remove('anthropic')
      chats().clearSetting('anthropic_last4')
      await stopGateway()
      return { ok: true, message: CREDENTIAL_MESSAGES.removed }
    },
    async connectStore(domain: string, password: string): Promise<SessionCommandResult> {
      try {
        const read = createShopifyReadService({
          userDataDir: opts.userDataDir,
          storeId: storeIdOf(domain),
          storeDomain: domain,
          image: opts.shopifyImage,
          getThemeToken: async () => password,
        })
        await read.listThemes()
        if (!secrets.available()) return fail(CREDENTIAL_MESSAGES.unavailable)
        secrets.save('shopify', password)
        chats().setSetting('store_domain', domain)
        return { ok: true, message: CREDENTIAL_MESSAGES.storeSaved }
      } catch (err) {
        return fail(err instanceof HostError ? err.userMessage : CREDENTIAL_MESSAGES.storeFailed)
      }
    },
    disconnectStore(): SessionCommandResult {
      secrets.remove('shopify')
      chats().clearSetting('store_domain')
      return { ok: true, message: CREDENTIAL_MESSAGES.storeRemoved }
    },
    async pullTheme(domain: string, themeId: number): Promise<SessionCommandResult> {
      try {
        if (!secrets.has('shopify')) return fail(CHANGE_MESSAGES.connectStore)
        const { storeId, records, read } = shopify(domain)
        const pulled = await read.pullTheme(themeId)
        if (pulled.theme.role === 'unpublished') {
          records.saveOwnership({
            storeId,
            themeId,
            kind: 'working-copy',
            name: pulled.theme.name,
            originThemeId: null,
            retired: false,
          })
        }
        const note =
          pulled.theme.role === 'unpublished'
            ? `Pulled ${pulled.theme.name}.`
            : `Pulled ${pulled.theme.name}. This theme can't be saved to.`
        return { ok: true, message: clip(note) }
      } catch (err) {
        logFailure('pull', err)
        return fail(err instanceof HostError ? err.userMessage : 'The theme could not be pulled.')
      }
    },
    listHistory(): HistoryView {
      const domain = storeDomain()
      const changes = domain
        ? openRecords(opts.userDataDir)
            .listChanges(storeIdOf(domain))
            .filter((change) => UUID.test(change.changeId))
            .slice(0, 200)
            .map((change) => ({ changeId: change.changeId, themeId: change.themeId, title: change.title.slice(0, 120) }))
        : []
      return {
        notice: notice(),
        chats: chats()
          .listChats()
          .filter((chat) => /^[a-zA-Z0-9-]{8,80}$/.test(chat.chatId) && /^\d{4}-\d{2}-\d{2}$/.test(chat.activeDay))
          .slice(0, 200)
          .map((chat) => ({ chatId: chat.chatId, themeId: chat.themeId, title: chat.title.slice(0, 120), activeDay: chat.activeDay })),
        changes,
      }
    },
    openChat(chatId: string): ChatOpen | null {
      const chat = chats().listChats().find((item) => item.chatId === chatId)
      if (!chat) return null
      return {
        title: chat.title.slice(0, 120),
        messages: chat.messages.slice(-200).map((message) => ({ role: message.role, text: message.text.slice(0, 4000) })),
      }
    },
    async deleteChat(chatId: string): Promise<SessionCommandResult> {
      chats().deleteChat(chatId)
      await rm(path.join(opts.userDataDir, 'chats', chatId), { recursive: true, force: true }).catch(() => {})
      return { ok: true, message: 'Chat deleted.' }
    },
    async undoChange(changeId: string): Promise<SessionCommandResult> {
      const domain = storeDomain()
      if (!domain) return fail(CHANGE_MESSAGES.connectStore)
      if (busy()) return fail('Save or discard the open change first.')
      const records = openRecords(opts.userDataDir)
      const record = records.getChange(changeId)
      if (!record || record.storeId !== storeIdOf(domain)) return fail('That change is no longer in history.')
      const theme = themePaths(opts.userDataDir, record.storeId, record.themeId)
      try {
        const git = await createGit(opts.userDataDir)
        const sessions = createSessionHistory(git)
        const before = await sessions.tip(theme.historyGit, SHOPIFY_REF)
        const reverted = await sessions.revertChange(theme.historyGit, record.commitId, record.title)
        if (!reverted.ok) {
          const later = await sessions.commitsAfter(theme.historyGit, record.commitId).catch((): string[] => [])
          const titles = records
            .listChanges(record.storeId)
            .filter((change) => later.includes(change.commitId) && change.changeId !== changeId)
            .map((change) => change.title)
          return fail(undoConflictMessage(titles))
        }
        try {
          await sessions.materialize(theme.historyGit, reverted.commit, theme.canonical)
          const files = reverted.files.filter(isThemePath)
          if (files.length > 0) await shopify(domain).gateway.pushSavedFiles(record.themeId, theme.canonical, files)
          records.saveChange({
            changeId: randomUUID(),
            storeId: record.storeId,
            themeId: record.themeId,
            commitId: reverted.commit,
            title: shortTitle(`Undo ${record.title}`),
            sensitiveFiles: [],
          })
          return { ok: true, message: clip(`Undid ${record.title}.`) }
        } catch (err) {
          if (before && COMMIT.test(before)) {
            await sessions.moveShopify(theme.historyGit, before, reverted.commit).catch(() => {})
            await sessions.materialize(theme.historyGit, before, theme.canonical).catch(() => {})
          }
          return fail(err instanceof HostError ? err.userMessage : 'That change could not be undone.')
        }
      } catch (err) {
        return fail(err instanceof HostError ? err.userMessage : 'That change could not be undone.')
      }
    },
    async checkGoLive(themeId: number): Promise<GoLiveView> {
      const empty = (detail: string): GoLiveView => ({
        items: goLiveChecklist({ unsaved: busy(), blocking: 0, liveChanges: [], previewReady: false }).map((item) =>
          item.id === 'check' ? { ...item, passed: false, detail } : item,
        ),
        liveFiles: [],
        conflicts: [],
        instructions: [],
        themesUrl: null,
      })
      const domain = storeDomain()
      if (!domain) return empty(CHANGE_MESSAGES.connectStore)
      const storeId = storeIdOf(domain)
      const working = themePaths(opts.userDataDir, storeId, themeId)
      const present = await stat(working.canonical).catch(() => null)
      if (!present?.isDirectory()) return empty('Pull this theme before checking it.')
      let liveFiles: string[] = []
      let conflicts: string[] = []
      let liveError = ''
      try {
        const { read } = shopify(domain)
        const themes = await read.listThemes()
        const live = themes.find((theme) => theme.role === 'live')
        if (live && live.id !== themeId) {
          await read.pullTheme(live.id)
          const liveDir = themePaths(opts.userDataDir, storeId, live.id).canonical
          const git = await createGit(opts.userDataDir)
          const sessions = createSessionHistory(git)
          const stored = chats().getSetting(`origin:${storeId}:${themeId}`)
          const originCommit = stored && COMMIT.test(stored) ? stored : await sessions.root(working.historyGit)
          const originDir = path.join(working.themeDir, 'origin-snapshot')
          if (originCommit) await sessions.materialize(working.historyGit, originCommit, originDir)
          const origin = await hashTheme(originCommit ? originDir : working.canonical)
          const plan = planFileMerge(origin, await hashTheme(working.canonical), await hashTheme(liveDir))
          liveFiles = plan.takeLive
          conflicts = plan.conflicts
        }
      } catch (err) {
        liveError = err instanceof HostError ? err.userMessage : 'The live theme could not be compared.'
      }
      let blocking = 0
      try {
        const runner = createShopifyRunner({ image: opts.shopifyImage, getThemeToken })
        const offenses = await runner.themeCheck(working.canonical)
        const git = await createGit(opts.userDataDir)
        const tip = await createSessionHistory(git).tip(working.historyGit, SHOPIFY_REF)
        const baseline = tip ? (openRecords(opts.userDataDir).getBaseline(tip) ?? []) : []
        blocking = compareThemeCheck(baseline, offenses, []).blocking.length
      } catch {
        blocking = 1
      }
      let previewReady = false
      const preview = openRecords(opts.userDataDir).getPreview(storeId)
      if (preview && opts.capture) {
        try {
          const pages = pagesToCapture(domain, preview.themeId, ['index'])
          if (pages.length > 0) {
            await opts.capture(pages, path.join(opts.userDataDir, 'golive-shots'), 'after')
            previewReady = true
          }
        } catch {
          previewReady = false
        }
      }
      const items = goLiveChecklist({
        unsaved: busy(),
        blocking,
        liveChanges: liveError ? ['live'] : [...liveFiles, ...conflicts],
        previewReady,
      }).map((item) => (item.id === 'live' && liveError ? { ...item, passed: false, detail: liveError.slice(0, 300) } : item))
      const ready = items.filter((item) => item.id !== 'preview').every((item) => item.passed)
      return {
        items,
        liveFiles: liveFiles.filter(safeFile).slice(0, 200),
        conflicts: conflicts.filter(safeFile).slice(0, 200),
        instructions: ready ? [...GO_LIVE_STEPS] : [],
        themesUrl: `https://admin.shopify.com/store/${storeId}/themes`,
      }
    },
    async applyGoLive(themeId: number, choice: 'live' | 'working'): Promise<SessionCommandResult> {
      const domain = storeDomain()
      if (!domain) return fail(CHANGE_MESSAGES.connectStore)
      if (busy()) return fail('Save or discard the open change first.')
      const storeId = storeIdOf(domain)
      const working = themePaths(opts.userDataDir, storeId, themeId)
      try {
        const { read, gateway: push, records } = shopify(domain)
        const themes = await read.listThemes()
        const live = themes.find((theme) => theme.role === 'live')
        if (!live || live.id === themeId) return { ok: true, message: 'There are no live edits to bring in.' }
        await read.pullTheme(live.id)
        const liveDir = themePaths(opts.userDataDir, storeId, live.id).canonical
        const git = await createGit(opts.userDataDir)
        const history = createHistoryService(git)
        const sessions = createSessionHistory(git)
        const before = await sessions.tip(working.historyGit, SHOPIFY_REF)
        if (!before) return fail('Pull this theme before bringing in live edits.')
        const stored = chats().getSetting(`origin:${storeId}:${themeId}`)
        const originCommit = stored && COMMIT.test(stored) ? stored : await sessions.root(working.historyGit)
        const liveCommit = await sessions.snapshotCommit(working.historyGit, liveDir)
        const merged =
          choice === 'live' && originCommit
            ? await sessions.mergeCommits(working.historyGit, originCommit, before, liveCommit)
            : { ok: false as const, files: [] as string[] }
        if (merged.ok) {
          const files = (await sessions.diff(working.historyGit, before, merged.commit))
            .filter((change) => change.status !== 'deleted')
            .map((change) => change.path)
            .filter(isThemePath)
          await sessions.materialize(working.historyGit, merged.commit, working.canonical)
          try {
            if (files.length > 0) await push.pushSavedFiles(themeId, working.canonical, files)
            await sessions.moveShopify(working.historyGit, merged.commit, before)
          } catch (err) {
            await sessions.materialize(working.historyGit, before, working.canonical).catch(() => {})
            throw err
          }
        } else {
          const originDir = path.join(working.themeDir, 'origin-snapshot')
          if (originCommit) await sessions.materialize(working.historyGit, originCommit, originDir)
          const plan = planFileMerge(
            await hashTheme(originCommit ? originDir : working.canonical),
            await hashTheme(working.canonical),
            await hashTheme(liveDir),
          )
          for (const file of filesToTakeFromLive(plan, choice)) await takeFile(liveDir, working.canonical, file)
          const files = filesToTakeFromLive(plan, choice).filter(isThemePath)
          if (files.length > 0) await push.pushSavedFiles(themeId, working.canonical, files)
          await history.recordSync({
            gitDir: working.historyGit,
            treeDir: working.canonical,
            files: await listThemeFiles(working.canonical),
            source: { id: themeId, role: 'unpublished' },
          })
        }
        chats().setSetting(`origin:${storeId}:${themeId}`, liveCommit)
        records.saveChange({
          changeId: randomUUID(),
          storeId,
          themeId,
          commitId: (await createSessionHistory(git).tip(working.historyGit, SHOPIFY_REF)) ?? liveCommit,
          title: shortTitle('Bring in live theme changes'),
          sensitiveFiles: [],
        })
        return { ok: true, message: choice === 'working' ? 'Kept your version of the overlapping files.' : 'Live edits are now in this working copy.' }
      } catch (err) {
        return fail(err instanceof HostError ? err.userMessage : 'Those live changes could not be brought in.')
      }
    },
    async watchThemes(): Promise<RoleNotice> {
      const quiet = { notice: null, rollbackLabel: null, retiredThemeId: null }
      const domain = storeDomain()
      if (!domain || busy()) return quiet
      try {
        const { storeId, records, read } = shopify(domain)
        const themes = await read.listThemes()
        const previous = Number(chats().getSetting('live_theme_id'))
        const detected = detectRoleChanges({
          previousLiveId: Number.isSafeInteger(previous) && previous > 0 ? previous : null,
          ownership: records.listOwnership(storeId),
          themes,
        })
        if (detected.wentLive) {
          const owned = records.getOwnership(storeId, detected.wentLive.themeId)
          if (owned && !owned.retired) records.retire(storeId, detected.wentLive.themeId)
        }
        if (detected.rollback) {
          const previousOwned = records.getOwnership(storeId, detected.rollback.themeId)
          records.saveOwnership({
            storeId,
            themeId: detected.rollback.themeId,
            kind: previousOwned?.kind && previousOwned.kind !== 'preview' ? previousOwned.kind : 'adopted',
            name: detected.rollback.name,
            originThemeId: previousOwned?.originThemeId ?? null,
            retired: true,
          })
        }
        if (detected.liveThemeId) chats().setSetting('live_theme_id', String(detected.liveThemeId))
        return {
          notice: detected.wentLive ? 'Your working copy is now live.' : null,
          rollbackLabel: detected.rollback ? 'Previous live version (kept for rollback)' : null,
          retiredThemeId: detected.wentLive?.themeId ?? null,
        }
      } catch {
        return quiet
      }
    },
    async startWorkingCopy(themeId: number): Promise<SessionCommandResult> {
      const domain = storeDomain()
      if (!domain) return fail(CHANGE_MESSAGES.connectStore)
      const storeId = storeIdOf(domain)
      const records = openRecords(opts.userDataDir)
      const owned = records.getOwnership(storeId, themeId)
      if (!owned?.retired) return fail('Start a new working copy from the theme that just went live.')
      try {
        const { read, gateway: push } = shopify(domain)
        const source = themePaths(opts.userDataDir, storeId, themeId)
        if (!(await stat(source.canonical).catch(() => null))?.isDirectory()) await read.pullTheme(themeId)
        const created = await push.createWorkingCopy('[Builder] Working copy', source.canonical, themeId)
        const next = themePaths(opts.userDataDir, storeId, created.id)
        await cp(source.canonical, next.canonical, { recursive: true })
        await cp(source.historyGit, next.historyGit, { recursive: true }).catch(() => {})
        return { ok: true, message: clip(`New working copy ready. Theme id ${created.id}.`) }
      } catch (err) {
        return fail(err instanceof HostError ? err.userMessage : 'A new working copy could not be created.')
      }
    },
    updateStatus(): UpdateStatus {
      const decision = updateDecision({
        jobRunning: busy(),
        downloaded: false,
        signatureOk: true,
        current: opts.version,
        minimum: null,
      })
      return { message: decision.message, canRestart: decision.canRestart }
    },
  }
}

function safeFile(file: string): boolean {
  return file.length > 0 && file.length <= 300 && !file.includes('\n') && !file.includes('\0')
}

async function takeFile(fromDir: string, toDir: string, file: string) {
  if (!isThemePath(file)) return
  const source = path.join(fromDir, ...file.split('/'))
  const dest = path.join(toDir, ...file.split('/'))
  if (path.relative(toDir, dest).startsWith('..')) return
  try {
    await stat(source)
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(source, dest)
  } catch {
    await rm(dest, { force: true }).catch(() => {})
  }
}
