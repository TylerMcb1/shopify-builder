// The entire renderer API. Sandboxed: no Node, no shell, no filesystem (README 18, 20).
import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels } from '../shared/contracts/channels.ts'
import type { OpenExternalResult, SetupStatus } from '../shared/contracts/setup.ts'

const api = {
  getSetupStatus: (): Promise<SetupStatus> => ipcRenderer.invoke(ipcChannels.getSetupStatus),
  retryDocker: (): Promise<SetupStatus> => ipcRenderer.invoke(ipcChannels.retryDocker),
  openExternal: (url: string): Promise<OpenExternalResult> => ipcRenderer.invoke(ipcChannels.openExternal, url),
}

contextBridge.exposeInMainWorld('shopifyBuilder', api)

export type ShopifyBuilderApi = typeof api
