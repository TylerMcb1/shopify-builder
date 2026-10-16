// When an update may be installed, and when tool images may switch (README 21).
import path from 'node:path'
export interface UpdateDecision {
  canRestart: boolean
  blocked: boolean
  message: string
}

export function updateDecision(input: {
  jobRunning: boolean
  downloaded: boolean
  signatureOk: boolean
  current: string
  minimum: string | null
}): UpdateDecision {
  if (input.minimum && compareVersions(input.current, input.minimum) < 0 && !input.jobRunning) {
    return { canRestart: false, blocked: true, message: 'Update Shopify Builder before starting another change.' }
  }
  if (!input.downloaded) return { canRestart: false, blocked: false, message: "You're up to date." }
  if (!input.signatureOk) return { canRestart: false, blocked: false, message: 'The update was rejected because its signature did not match.' }
  if (input.jobRunning) return { canRestart: false, blocked: false, message: 'An update is ready. It will wait until this change is finished.' }
  return { canRestart: true, blocked: false, message: 'An update is ready.' }
}

export function imageSwitch<T extends Record<string, string>>(input: { previous: T; candidate: T; verified: boolean }): { use: T; removePrevious: boolean } {
  if (!input.verified) return { use: input.previous, removePrevious: false }
  return { use: input.candidate, removePrevious: true }
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number(part) || 0)
  const b = right.split('.').map((part) => Number(part) || 0)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The secrets file lives in user data, so an app update does not take it with the old install. */
export function credentialsSurviveUpdate(userDataDir: string, installDir: string): boolean {
  const secret = path.resolve(userDataDir)
  const install = path.resolve(installDir)
  const relative = path.relative(install, secret)
  return relative.startsWith('..') || path.isAbsolute(relative)
}
