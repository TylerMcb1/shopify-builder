// The entire renderer API. Sandboxed: no Node, no shell, no filesystem (README 18, 20).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ipcChannels, sessionEventChannel } from '../shared/contracts/channels.ts'
import { SessionEventSchema, type SessionCommandResult, type SessionEvent, type StartSessionInput } from '../shared/contracts/session.ts'
import type { OpenExternalResult, SetupStatus } from '../shared/contracts/setup.ts'
import type { ChatOpen, CredentialStatus, GoLiveView, HistoryView, RoleNotice, UpdateStatus } from '../shared/contracts/account.ts'

const api = {
  getSetupStatus: (): Promise<SetupStatus> => ipcRenderer.invoke(ipcChannels.getSetupStatus),
  retryDocker: (): Promise<SetupStatus> => ipcRenderer.invoke(ipcChannels.retryDocker),
  openExternal: (url: string): Promise<OpenExternalResult> => ipcRenderer.invoke(ipcChannels.openExternal, url),
  startSession: (input: StartSessionInput): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.startSession, input),
  sendMessage: (text: string): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.sendMessage, { text }),
  decideApproval: (requestId: string, decision: 'approve' | 'decline'): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.decideApproval, { requestId, decision }),
  answerQuestion: (requestId: string, text: string): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.answerQuestion, { requestId, text }),
  cancelSession: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.cancelSession),
  saveSession: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.saveSession),
  discardSession: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.discardSession),
  undoStep: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.undoStep),
  redoOnLatest: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.redoOnLatest),
  retryStep: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.retryStep),
  readShot: (page: string, viewport: 'desktop' | 'mobile', when: 'before' | 'after') =>
    ipcRenderer.invoke(ipcChannels.readShot, { page, viewport, when }),
  connectStore: (domain: string, password: string): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.connectStore, { domain, password }),
  pullTheme: (domain: string, themeId: number): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.pullTheme, { domain, themeId }),
  saveKey: (key: string): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.saveKey, { key }),
  removeKey: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.removeKey),
  credentialStatus: (): Promise<CredentialStatus> => ipcRenderer.invoke(ipcChannels.credentialStatus),
  disconnectStore: (): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.disconnectStore),
  listHistory: (): Promise<HistoryView> => ipcRenderer.invoke(ipcChannels.listHistory),
  openChat: (chatId: string): Promise<ChatOpen> => ipcRenderer.invoke(ipcChannels.openChat, { chatId }),
  deleteChat: (chatId: string): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.deleteChat, { chatId }),
  undoChange: (changeId: string): Promise<SessionCommandResult> => ipcRenderer.invoke(ipcChannels.undoChange, { changeId }),
  checkGoLive: (themeId: number): Promise<GoLiveView> => ipcRenderer.invoke(ipcChannels.checkGoLive, { themeId }),
  applyGoLive: (themeId: number, choice: 'live' | 'working'): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.applyGoLive, { themeId, choice }),
  watchThemes: (): Promise<RoleNotice> => ipcRenderer.invoke(ipcChannels.watchThemes),
  startWorkingCopy: (themeId: number): Promise<SessionCommandResult> =>
    ipcRenderer.invoke(ipcChannels.startWorkingCopy, { themeId }),
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(ipcChannels.updateStatus),
  onSessionEvent: (listener: (event: SessionEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = SessionEventSchema.safeParse(payload)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on(sessionEventChannel, wrapped)
    return () => ipcRenderer.removeListener(sessionEventChannel, wrapped)
  },
}

contextBridge.exposeInMainWorld('shopifyBuilder', api)

export type ShopifyBuilderApi = typeof api
