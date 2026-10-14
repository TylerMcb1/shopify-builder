// The only IPC channels the preload may call (README 18, 20).
export const ipcChannels = {
  getSetupStatus: 'setup:getStatus',
  retryDocker: 'setup:retryDocker',
  openExternal: 'links:open',
  startSession: 'session:start',
  sendMessage: 'session:sendMessage',
  decideApproval: 'session:decideApproval',
  answerQuestion: 'session:answerQuestion',
  cancelSession: 'session:cancel',
  saveSession: 'session:save',
  discardSession: 'session:discard',
  undoStep: 'session:undoStep',
  redoOnLatest: 'session:redo',
  readShot: 'session:readShot',
  connectStore: 'store:connect',
  pullTheme: 'theme:pull',
} as const

/** Main → renderer. The preload listens to this name only; callers cannot choose a channel. */
export const sessionEventChannel = 'session:event'

export const ipcChannelNames = Object.values(ipcChannels)
