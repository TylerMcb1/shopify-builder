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
  readShot: (page: string, viewport: 'desktop' | 'mobile', when: 'before' | 'after') => Promise<{ ok: true; dataUrl: string } | { ok: false; message: string }>
  connectStore: (domain: string, password: string) => Promise<SessionCommandResult>
  pullTheme: (domain: string, themeId: number) => Promise<SessionCommandResult>
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
