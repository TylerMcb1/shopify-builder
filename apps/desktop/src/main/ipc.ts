import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcChannels } from '../shared/contracts/channels.ts'
import {
  LINK_DENIED,
  OpenExternalResultSchema,
  SetupStatusSchema,
  type OpenExternalResult,
  type SetupStatus,
} from '../shared/contracts/setup.ts'
import { isTrustedRendererUrl } from '../shared/security/baseline.ts'

export interface IpcHandlers {
  getAppUrl: () => string
  getSetupStatus: () => Promise<SetupStatus>
  openExternal: (url: string) => Promise<OpenExternalResult>
}

export function registerIpc(ipcMain: IpcMain, handlers: IpcHandlers): void {
  const guard = (event: IpcMainInvokeEvent) => {
    const frameUrl = event.senderFrame?.url ?? ''
    if (!isTrustedRendererUrl(frameUrl, handlers.getAppUrl())) {
      throw new Error('untrusted sender')
    }
  }

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
