// Host data layout under the app's user-data folder (README 6.1).
import path from 'node:path'

const STORE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface ThemePaths {
  themeDir: string
  canonical: string
  inbox: string
  historyGit: string
}

export function assertThemeId(themeId: unknown): asserts themeId is number {
  if (typeof themeId !== 'number' || !Number.isSafeInteger(themeId) || themeId <= 0) throw new Error('invalid theme id')
}

export function themePaths(userDataDir: string, storeId: string, themeId: number): ThemePaths {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute')
  if (!STORE_ID.test(storeId)) throw new Error('invalid store id')
  assertThemeId(themeId)
  const themeDir = path.join(userDataDir, 'stores', storeId, 'themes', String(themeId))
  return {
    themeDir,
    canonical: path.join(themeDir, 'canonical'),
    inbox: path.join(themeDir, 'inbox'),
    historyGit: path.join(themeDir, 'history.git'),
  }
}
