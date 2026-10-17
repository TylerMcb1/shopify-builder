// Starts one agent session from the main process (README 6.2). The renderer cannot supply mounts or docker arguments.
import { spawn, type ChildProcess } from 'node:child_process'
import { stat, readFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { HostError } from '../../../../packages/host/src/errors.ts'
import { randomUUID } from 'node:crypto'
import { createAgentSession, type AgentSession } from '../../../../packages/host/src/agent/session.ts'
import {
  agentContainerName,
  buildAgentKillArgs,
  buildAgentNetworkCreateArgs,
  buildAgentNetworkInspectArgs,
  buildAgentRunArgs,
  interpretAgentNetwork,
} from '../../../../packages/host/src/agent/run-args.ts'
import { createChangeLoop } from '../../../../packages/host/src/change/loop.ts'
import { CHANGE_MESSAGES } from '../../../../packages/host/src/change/messages.ts'
import { createGit } from '../../../../packages/host/src/git/git.ts'
import { createSessionHistory, shortTitle } from '../../../../packages/host/src/git/session.ts'
import { openChats } from '../../../../packages/host/src/history/chats.ts'
import { todayUtc, type ChatLine } from '../../../../packages/host/src/history/retention.ts'
import { openRecords } from '../../../../packages/host/src/records/store.ts'
import { prepareSessionWorkspace, discardSessionDir } from '../../../../packages/host/src/agent/workspace.ts'
import {
  SESSION_MESSAGES,
  SessionEventSchema,
  StartSessionInputSchema,
  type SessionCommandResult,
  type SessionEvent,
  type StartSessionInput,
} from '../../../../packages/host/src/agent/protocol.ts'
import { dockerExec } from '../../../../packages/host/src/docker/exec.ts'
import { createShopifyReadService } from '../../../../packages/host/src/shopify/read-service.ts'
import { createShopifyRunner } from '../../../../packages/host/src/shopify/runner.ts'
import { createWriteGateway } from '../../../../packages/host/src/shopify/gateway.ts'
import { type PreviewPage } from '../../../../packages/host/src/preview/url.ts'

export interface SessionLaunch {
  sessionId: string
  workspaceHostPath: string
  agentStateHostPath: string
}

import { sessionPaths, themePaths, type SessionPaths } from '../../../../packages/host/src/store/layout.ts'

export interface ShopifyConnection {
  image: string
  getThemeToken: () => Promise<string>
  capture?: (pages: PreviewPage[], dir: string, when: 'before' | 'after') => Promise<void>
}

export function createSessionBridge(deps: {
  userDataDir: string
  image: string
  send: (event: SessionEvent) => void
  dockerCommand?: string
  /** Test hook. Production leaves this unset and starts the pinned image. */
  startProcess?: (launch: SessionLaunch) => ChildProcess
  readyTimeoutMs?: number
  stepTimeoutMs?: number
  idleTimeoutMs?: number
  /** Real Shopify image. When set, steps are checked and saves go through the write gateway. */
  shopify?: ShopifyConnection
  /** Starts the Claude gateway after the agent network exists. */
  prepareAgent?: () => Promise<SessionCommandResult | void>
  /** Stops the gateway when no session is left. */
  onSessionEnded?: () => Promise<void>
}): {
  start(input: StartSessionInput): Promise<SessionCommandResult>
  sendMessage(text: string): Promise<SessionCommandResult>
  decideApproval(requestId: string, decision: 'approve' | 'decline'): Promise<SessionCommandResult>
  answerQuestion(requestId: string, text: string): Promise<SessionCommandResult>
  cancel(): Promise<SessionCommandResult>
  save(): Promise<SessionCommandResult>
  discard(): Promise<SessionCommandResult>
  undoStep(): Promise<SessionCommandResult>
  redoOnLatest(): Promise<SessionCommandResult>
  retryStep(): Promise<SessionCommandResult>
  readShot(page: string, viewport: 'desktop' | 'mobile', when: 'before' | 'after'): Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>
  storeDomain(): string | null
  busy(): boolean
} {
  const docker = deps.dockerCommand ?? 'docker'
  let current: AgentSession | null = null
  let loop: ReturnType<typeof createChangeLoop> | null = null
  let paths: SessionPaths | null = null
  let domain: string | null = null
  let seq = 0
  let lines: ChatLine[] = []
  let chatTheme = 0
  let chatId = ''

  const remember = (role: ChatLine['role'], text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 4000)
    if (clean) lines.push({ role, text: clean })
  }

  const publish = (event: SessionEvent) => {
    if (event.type === 'assistant') remember('claude', event.text)
    if (event.type === 'question') remember('claude', event.text)
    if (event.type === 'step_ready') remember('claude', event.summary)
    seq += 1
    deps.send(SessionEventSchema.parse({ ...event, seq }))
  }

  async function finishSession(): Promise<void> {
    if (chatId && lines.length > 0) {
      if (paths) await cp(path.join(paths.sessionDir, 'shots'), path.join(deps.userDataDir, 'chats', chatId, 'shots'), { recursive: true }).catch(() => {})
      openChats(deps.userDataDir).saveChat({
        chatId,
        themeId: chatTheme,
        title: shortTitle(lines.find((line) => line.role === 'user')?.text ?? 'theme change'),
        activeDay: todayUtc(),
        messages: lines.slice(-200),
      })
    }
    lines = []
    chatId = ''
    openChats(deps.userDataDir).clearSetting('open_session')
    await deps.onSessionEnded?.().catch(() => {})
  }

  async function ensureNetwork(): Promise<void> {
    const inspected = await dockerExec(docker, buildAgentNetworkInspectArgs())
    const state = interpretAgentNetwork(inspected.exitCode, inspected.stdout)
    if (state === 'ready') return
    if (state === 'not-internal') throw new HostError('docker-unavailable', 'Please open Docker Desktop, then click Retry.')
    const created = await dockerExec(docker, buildAgentNetworkCreateArgs())
    if (created.exitCode !== 0 && !/already exists/i.test(created.stderr)) {
      throw new HostError('docker-unavailable', 'Please open Docker Desktop, then click Retry.')
    }
  }

  return {
    storeDomain: () => domain,
    busy: () => current !== null || loop !== null,
    async start(input) {
      const parsed = StartSessionInputSchema.safeParse(input)
      if (!parsed.success) return { ok: false, message: SESSION_MESSAGES.unexpected }
      if (current) return { ok: false, message: SESSION_MESSAGES.busy }
      const { storeId, themeId, resumeSessionId } = parsed.data
      const sessionId = resumeSessionId ?? randomUUID()
      domain = parsed.data.storeDomain ?? domain
      try {
        const theme = themePaths(deps.userDataDir, storeId, themeId)
        const canonical = await stat(theme.canonical).catch(() => null)
        if (!canonical?.isDirectory()) return { ok: false, message: 'Pull this theme before starting a change.' }
        if (!deps.startProcess) await ensureNetwork()
        if (deps.prepareAgent) {
          const ready = await deps.prepareAgent()
          if (ready && ready.ok === false) return ready
        }
        paths = sessionPaths(deps.userDataDir, storeId, sessionId)
        publish(SessionEventSchema.parse({
          sessionId,
          seq: 1,
          type: 'progress',
          stage: 'preparing_workspace',
          label: 'Preparing workspace',
        }))
        await prepareSessionWorkspace({
          canonicalDir: theme.canonical,
          paths,
          themeId,
          storeId,
          resume: Boolean(resumeSessionId),
        })
        chatId = sessionId
        chatTheme = themeId
        lines = []
        openChats(deps.userDataDir).setSetting('open_session', JSON.stringify({ activeDay: todayUtc(), sessionDir: paths.sessionDir }))
        const launch = { sessionId, workspaceHostPath: paths.workspace, agentStateHostPath: paths.agentState }
        let active: ReturnType<typeof createChangeLoop> | null = null
        const session = createAgentSession({
          sessionId,
          resume: Boolean(resumeSessionId),
          readyTimeoutMs: deps.readyTimeoutMs,
          stepTimeoutMs: deps.stepTimeoutMs,
          idleTimeoutMs: deps.idleTimeoutMs,
          onDiagnostic: (text) => console.error(`[shopify-builder] change assistant: ${text.slice(0, 2500)}`),
          onEvent: (event) => {
            if (event.type === 'step_result' && active) {
              void active.afterStep(event)
              return
            }
            if (event.type === 'error' && active) void active.abandonStep()
            publish(event)
            if (event.type === 'error' && event.code !== 'model') {
              current = null
              loop = null
              void finishSession()
            }
          },
          stop: deps.startProcess
            ? undefined
            : () => {
                spawn(docker, buildAgentKillArgs(agentContainerName(sessionId)), {
                  shell: false,
                  stdio: 'ignore',
                  windowsHide: true,
                }).on('error', () => {})
              },
          startProcess: () => {
            const child = deps.startProcess
              ? deps.startProcess(launch)
              : spawn(docker, buildAgentRunArgs({ ...launch, image: deps.image, containerName: agentContainerName(sessionId) }), {
                  shell: false,
                  stdio: ['pipe', 'pipe', 'pipe'],
                  windowsHide: true,
                })
            child.on('exit', () => {
              if (current === session) current = null
            })
            return child
          },
        })
        if (deps.shopify && domain) {
          try {
            const git = await createGit(deps.userDataDir)
            const history = createSessionHistory(git)
            const branch = await history.ensureBranch(theme.historyGit, sessionId)
            const shopify = deps.shopify
            const storeDomain = domain
            const runner = createShopifyRunner({ image: shopify.image, getThemeToken: shopify.getThemeToken })
            const read = createShopifyReadService({
              userDataDir: deps.userDataDir,
              storeId,
              storeDomain,
              image: shopify.image,
              getThemeToken: shopify.getThemeToken,
            })
            const gateway = createWriteGateway({
              storeId,
              storeDomain,
              records: openRecords(deps.userDataDir),
              listThemes: () => read.listThemes(),
              runPush: (args, dir) => runner.push(args, dir),
            })
            const sessionPathsNow = paths
            active = createChangeLoop({
              storeId,
              themeId,
              storeDomain,
              sessionId,
              workspace: paths.workspace,
              canonical: theme.canonical,
              gitDir: theme.historyGit,
              baseCommit: branch.commit,
              send: publish,
              session,
              history,
              records: openRecords(deps.userDataDir),
              log: (text) => console.error(`[shopify-builder] ${text.slice(0, 2000)}`),
              ports: {
                runThemeCheck: (dir) => runner.themeCheck(dir),
                syncTheme: async () => (await read.syncTheme(themeId)).sync,
                pushPreview: async (mode, _files, treeDir) => {
                  const records = openRecords(deps.userDataDir)
                  let previewId = records.getPreview(storeId)?.themeId
                  if (!previewId) {
                    const created = await gateway.createPreview(treeDir, 'development')
                    previewId = created.id
                  }
                  if (mode === 'mirror') await gateway.mirrorPreview(previewId, treeDir)
                  else await gateway.pushPreviewFiles(previewId, treeDir, _files)
                  return previewId
                },
                pushSave: (files, treeDir) => gateway.pushSavedFiles(themeId, treeDir, files),
                capture: shopify.capture
                  ? (pages, when) => shopify.capture!(pages, path.join(sessionPathsNow.sessionDir, 'shots'), when)
                  : undefined,
              },
            })
            await active.recover()
          } catch (err) {
            console.error(`[shopify-builder] change setup failed: ${err instanceof Error ? err.message : String(err)}`)
            session.cancel()
            throw new HostError('history-failed', "Couldn't open this theme's history, so the change can't start. Your files haven't changed.")
          }
        }
        current = session
        loop = active
        await session.ready
        if (active) void active.preparePreview()
        return { ok: true, sessionId }
      } catch (err) {
        await deps.onSessionEnded?.().catch(() => {})
        if (current) {
          current.cancel()
          current = null
        }
        loop = null
        if (err instanceof HostError) return { ok: false, message: err.userMessage }
        const message = err instanceof Error ? err.message : ''
        console.error(`[shopify-builder] start failed: ${message.slice(0, 2000)}`)
        if (message === SESSION_MESSAGES.didNotStart || message === SESSION_MESSAGES.malformed) {
          return { ok: false, message: SESSION_MESSAGES.didNotStart }
        }
        return { ok: false, message: 'The change assistant could not start.' }
      }
    },
    sendMessage(text) {
      if (!current) return Promise.resolve({ ok: false, message: SESSION_MESSAGES.noSession })
      remember('user', text)
      loop?.noteUserMessage(text)
      return Promise.resolve(current.sendUserMessage(text))
    },
    decideApproval(requestId, decision) {
      const handled = loop?.decideApproval(requestId, decision)
      if (handled) return Promise.resolve(handled)
      if (!current) return Promise.resolve({ ok: false, message: SESSION_MESSAGES.noSession })
      return Promise.resolve(current.decideApproval(requestId, decision))
    },
    answerQuestion(requestId, text) {
      if (!current) return Promise.resolve({ ok: false, message: SESSION_MESSAGES.noSession })
      remember('user', text)
      return Promise.resolve(current.answerQuestion(requestId, text))
    },
    async cancel() {
      if (!current) return { ok: false, message: SESSION_MESSAGES.noSession }
      current.cancel()
      current = null
      loop = null
      await finishSession()
      return { ok: true }
    },
    async save() {
      if (!loop) return { ok: false, message: CHANGE_MESSAGES.connectStore }
      const result = await loop.save()
      if (result.status === 'saved') {
        current?.cancel()
        await finishSession()
        if (paths) await discardSessionDir(paths).catch(() => {})
        current = null
        loop = null
        paths = null
      }
      return result
    },
    async discard() {
      if (!current && !loop) return { ok: false, message: SESSION_MESSAGES.noSession }
      await loop?.discard().catch(() => {})
      current?.cancel()
      await finishSession()
      if (paths) await discardSessionDir(paths).catch(() => {})
      current = null
      loop = null
      paths = null
      return { ok: true, message: CHANGE_MESSAGES.discarded }
    },
    async undoStep() {
      if (!loop) return { ok: false, message: SESSION_MESSAGES.noSession }
      try {
        return await loop.undoStep()
      } catch (err) {
        console.error(`[shopify-builder] undo failed: ${err instanceof Error ? err.message : String(err)}`)
        return { ok: false, message: "That step couldn't be undone. Your theme hasn't changed." }
      }
    },
    async redoOnLatest() {
      if (!loop) return { ok: false, message: SESSION_MESSAGES.noSession }
      try {
        return await loop.redoOnLatest()
      } catch (err) {
        console.error(`[shopify-builder] start over failed: ${err instanceof Error ? err.message : String(err)}`)
        return { ok: false, message: "Couldn't load the latest version from Shopify. Please try again." }
      }
    },
    async retryStep() {
      if (!loop || !current) {
        console.error('[shopify-builder] try again refused: the change assistant is no longer running')
        return { ok: false, message: SESSION_MESSAGES.noSession }
      }
      const result = loop.retry()
      if (!result.ok) console.error(`[shopify-builder] try again refused: ${result.message ?? ''}`)
      return result
    },
    async readShot(page, viewport, when) {
      if (!paths) return { ok: false, message: 'There is no preview yet.' }
      const safePage = page.replace(/[^a-z0-9_-]/gi, '')
      if (!safePage) return { ok: false, message: 'There is no preview yet.' }
      const shots = path.join(paths.sessionDir, 'shots')
      const file = path.join(shots, `${when}-${viewport}-${safePage}.png`)
      if (!file.startsWith(shots + path.sep)) return { ok: false, message: 'There is no preview yet.' }
      try {
        const bytes = await readFile(file)
        return { ok: true, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
      } catch {
        return { ok: false, message: 'There is no preview yet.' }
      }
    },
  }
}
