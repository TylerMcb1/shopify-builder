// The only IPC channels the preload may call (README 18, 20). Phase 1 implements setup and links.
export const ipcChannels = {
  getSetupStatus: 'setup:getStatus',
  retryDocker: 'setup:retryDocker',
  openExternal: 'links:open',
} as const

export const ipcChannelNames = Object.values(ipcChannels)
