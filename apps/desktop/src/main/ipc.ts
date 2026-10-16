import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { z } from 'zod'
import { ipcChannels } from '../shared/contracts/channels.ts'
import {
  ApprovalDecisionInputSchema,
  QuestionAnswerInputSchema,
  SendMessageInputSchema,
  SessionCommandResultSchema,
  StartSessionInputSchema,
  type SessionCommandResult,
  type StartSessionInput,
} from '../shared/contracts/session.ts'
import {
  LINK_DENIED,
  OpenExternalResultSchema,
  SetupStatusSchema,
  type OpenExternalResult,
  type SetupStatus,
} from '../shared/contracts/setup.ts'
import { isTrustedRendererUrl } from '../shared/security/baseline.ts'
import { SESSION_MESSAGES } from '../../../../packages/host/src/agent/protocol.ts'
import { CREDENTIAL_MESSAGES } from '../../../../packages/host/src/credentials/messages.ts'
import {
  ChatOpenSchema,
  CredentialStatusSchema,
  GoLiveViewSchema,
  HistoryViewSchema,
  RoleNoticeSchema,
  UpdateStatusSchema,
  type ChatOpen,
  type CredentialStatus,
  type GoLiveView,
  type HistoryView,
  type RoleNotice,
  type UpdateStatus,
} from '../shared/contracts/account.ts'

export interface IpcHandlers {
  getAppUrl: () => string
  getSetupStatus: () => Promise<SetupStatus>
  openExternal: (url: string) => Promise<OpenExternalResult>
  startSession: (input: StartSessionInput) => Promise<SessionCommandResult>
  sendMessage: (text: string) => Promise<SessionCommandResult>
  decideApproval: (requestId: string, decision: 'approve' | 'decline') => Promise<SessionCommandResult>
  answerQuestion: (requestId: string, text: string) => Promise<SessionCommandResult>
  cancelSession: () => Promise<SessionCommandResult>
  saveSession: () => Promise<SessionCommandResult>
  discardSession: () => Promise<SessionCommandResult>
  undoStep: () => Promise<SessionCommandResult>
  redoOnLatest: () => Promise<SessionCommandResult>
  retryStep: () => Promise<SessionCommandResult>
  readShot: (page: string, viewport: 'desktop' | 'mobile', when: 'before' | 'after') => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>
  connectStore: (domain: string, password: string) => Promise<SessionCommandResult>
  pullTheme: (domain: string, themeId: number) => Promise<SessionCommandResult>
  saveKey: (key: string) => Promise<SessionCommandResult>
  removeKey: () => Promise<SessionCommandResult>
  credentialStatus: () => CredentialStatus
  disconnectStore: () => SessionCommandResult
  listHistory: () => HistoryView
  openChat: (chatId: string) => ChatOpen | null
  deleteChat: (chatId: string) => Promise<SessionCommandResult>
  undoChange: (changeId: string) => Promise<SessionCommandResult>
  checkGoLive: (themeId: number) => Promise<GoLiveView>
  applyGoLive: (themeId: number, choice: 'live' | 'working') => Promise<SessionCommandResult>
  watchThemes: () => Promise<RoleNotice>
  startWorkingCopy: (themeId: number) => Promise<SessionCommandResult>
  updateStatus: () => UpdateStatus
}

export function registerIpc(ipcMain: IpcMain, handlers: IpcHandlers): void {
  const guard = (event: IpcMainInvokeEvent) => {
    const frameUrl = event.senderFrame?.url ?? ''
    if (!isTrustedRendererUrl(frameUrl, handlers.getAppUrl())) {
      throw new Error('untrusted sender')
    }
  }
  const command = (result: SessionCommandResult) => SessionCommandResultSchema.parse(result)
  const rejected = () => command({ ok: false, message: SESSION_MESSAGES.unexpected })

  ipcMain.handle(ipcChannels.getSetupStatus, async (event) => {
    guard(event)
    return SetupStatusSchema.parse(await handlers.getSetupStatus())
  })
  ipcMain.handle(ipcChannels.retryDocker, async (event) => {
    guard(event)
    return SetupStatusSchema.parse(await handlers.getSetupStatus())
  })
  ipcMain.handle(ipcChannels.openExternal, async (event, raw: unknown) => {
    guard(event)
    if (typeof raw !== 'string') return OpenExternalResultSchema.parse({ ok: false, message: LINK_DENIED })
    return OpenExternalResultSchema.parse(await handlers.openExternal(raw))
  })
  ipcMain.handle(ipcChannels.startSession, async (event, raw: unknown) => {
    guard(event)
    const parsed = StartSessionInputSchema.safeParse(raw)
    if (!parsed.success) return rejected()
    return command(await handlers.startSession(parsed.data))
  })
  ipcMain.handle(ipcChannels.sendMessage, async (event, raw: unknown) => {
    guard(event)
    const parsed = SendMessageInputSchema.safeParse(raw)
    if (!parsed.success) return rejected()
    return command(await handlers.sendMessage(parsed.data.text))
  })
  ipcMain.handle(ipcChannels.decideApproval, async (event, raw: unknown) => {
    guard(event)
    const parsed = ApprovalDecisionInputSchema.safeParse(raw)
    if (!parsed.success) return rejected()
    return command(await handlers.decideApproval(parsed.data.requestId, parsed.data.decision))
  })
  ipcMain.handle(ipcChannels.answerQuestion, async (event, raw: unknown) => {
    guard(event)
    const parsed = QuestionAnswerInputSchema.safeParse(raw)
    if (!parsed.success) return rejected()
    return command(await handlers.answerQuestion(parsed.data.requestId, parsed.data.text))
  })
  ipcMain.handle(ipcChannels.cancelSession, async (event) => {
    guard(event)
    return command(await handlers.cancelSession())
  })
  ipcMain.handle(ipcChannels.saveSession, async (event) => {
    guard(event)
    return command(await handlers.saveSession())
  })
  ipcMain.handle(ipcChannels.discardSession, async (event) => {
    guard(event)
    return command(await handlers.discardSession())
  })
  ipcMain.handle(ipcChannels.undoStep, async (event) => {
    guard(event)
    return command(await handlers.undoStep())
  })
  ipcMain.handle(ipcChannels.redoOnLatest, async (event) => {
    guard(event)
    return command(await handlers.redoOnLatest())
  })
  ipcMain.handle(ipcChannels.retryStep, async (event) => {
    guard(event)
    return command(await handlers.retryStep())
  })
  ipcMain.handle(ipcChannels.readShot, async (event, raw: unknown) => {
    guard(event)
    const parsed = z
      .object({
        page: z.string().min(1).max(80),
        viewport: z.enum(['desktop', 'mobile']),
        when: z.enum(['before', 'after']),
      })
      .strict()
      .safeParse(raw)
    if (!parsed.success) return { ok: false, message: SESSION_MESSAGES.unexpected }
    return handlers.readShot(parsed.data.page, parsed.data.viewport, parsed.data.when)
  })
  ipcMain.handle(ipcChannels.connectStore, async (event, raw: unknown) => {
    guard(event)
    const parsed = z
      .object({
        domain: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/),
        password: z.string().min(1).max(200),
      })
      .strict()
      .safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.connectStore(parsed.data.domain, parsed.data.password))
  })
  ipcMain.handle(ipcChannels.pullTheme, async (event, raw: unknown) => {
    guard(event)
    const parsed = z
      .object({
        domain: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/),
        themeId: z.number().int().positive(),
      })
      .strict()
      .safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.pullTheme(parsed.data.domain, parsed.data.themeId))
  })
  ipcMain.handle(ipcChannels.saveKey, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ key: z.string().min(1).max(300) }).strict().safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: CREDENTIAL_MESSAGES.badKey })
    return command(await handlers.saveKey(parsed.data.key))
  })
  ipcMain.handle(ipcChannels.removeKey, async (event) => {
    guard(event)
    return command(await handlers.removeKey())
  })
  ipcMain.handle(ipcChannels.credentialStatus, async (event) => {
    guard(event)
    return CredentialStatusSchema.parse(handlers.credentialStatus())
  })
  ipcMain.handle(ipcChannels.disconnectStore, async (event) => {
    guard(event)
    return command(handlers.disconnectStore())
  })
  ipcMain.handle(ipcChannels.listHistory, async (event) => {
    guard(event)
    return HistoryViewSchema.parse(handlers.listHistory())
  })
  ipcMain.handle(ipcChannels.openChat, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ chatId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/) }).strict().safeParse(raw)
    if (!parsed.success) return ChatOpenSchema.parse({ title: 'Chat', messages: [] })
    return ChatOpenSchema.parse(handlers.openChat(parsed.data.chatId) ?? { title: 'Chat', messages: [] })
  })
  ipcMain.handle(ipcChannels.deleteChat, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ chatId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/) }).strict().safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.deleteChat(parsed.data.chatId))
  })
  ipcMain.handle(ipcChannels.undoChange, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ changeId: z.string().uuid() }).strict().safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.undoChange(parsed.data.changeId))
  })
  ipcMain.handle(ipcChannels.checkGoLive, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ themeId: z.number().int().positive() }).strict().safeParse(raw)
    if (!parsed.success) {
      return GoLiveViewSchema.parse({ items: [], liveFiles: [], conflicts: [], instructions: [], themesUrl: null })
    }
    return GoLiveViewSchema.parse(await handlers.checkGoLive(parsed.data.themeId))
  })
  ipcMain.handle(ipcChannels.applyGoLive, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ themeId: z.number().int().positive(), choice: z.enum(['live', 'working']) }).strict().safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.applyGoLive(parsed.data.themeId, parsed.data.choice))
  })
  ipcMain.handle(ipcChannels.watchThemes, async (event) => {
    guard(event)
    return RoleNoticeSchema.parse(await handlers.watchThemes())
  })
  ipcMain.handle(ipcChannels.startWorkingCopy, async (event, raw: unknown) => {
    guard(event)
    const parsed = z.object({ themeId: z.number().int().positive() }).strict().safeParse(raw)
    if (!parsed.success) return command({ ok: false, message: SESSION_MESSAGES.unexpected })
    return command(await handlers.startWorkingCopy(parsed.data.themeId))
  })
  ipcMain.handle(ipcChannels.updateStatus, async (event) => {
    guard(event)
    return UpdateStatusSchema.parse(handlers.updateStatus())
  })
}

export function hardenWebContents(contents: WebContents, appUrl: string): void {
  contents.on('will-navigate', (event, url) => {
    if (isNavigationBlocked(url, appUrl)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

export function isNavigationBlocked(url: string, appUrl: string): boolean {
  return !isTrustedRendererUrl(url, appUrl)
}
