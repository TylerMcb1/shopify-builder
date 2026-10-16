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
  retryStep: 'session:retry',
  readShot: 'session:readShot',
  connectStore: 'store:connect',
  pullTheme: 'theme:pull',
  saveKey: 'credentials:saveKey',
  removeKey: 'credentials:removeKey',
  credentialStatus: 'credentials:status',
  disconnectStore: 'store:disconnect',
  listHistory: 'history:list',
  openChat: 'history:open',
  deleteChat: 'history:deleteChat',
  undoChange: 'history:undoChange',
  checkGoLive: 'golive:check',
  applyGoLive: 'golive:apply',
  watchThemes: 'themes:watch',
  startWorkingCopy: 'themes:newCopy',
  updateStatus: 'updates:status',
} as const

/** Main → renderer. The preload listens to this name only; callers cannot choose a channel. */
export const sessionEventChannel = 'session:event'

export const ipcChannelNames = Object.values(ipcChannels)
