// The only host path that pushes theme files (README 9.2, 9.4, 11).
import { randomUUID } from 'node:crypto'
import { HostError } from '../errors.ts'
import { CHANGE_MESSAGES } from '../change/messages.ts'
import { type Records, type ThemeKind } from '../records/store.ts'
import { parseThemeList, ThemeSchema, type Theme } from './schemas.ts'
import { buildThemePushArgs, writeAllowed, type PushKind } from './push.ts'
import { z } from 'zod'

const PushResultSchema = z.object({ theme: ThemeSchema }).passthrough()

export function parsePushResult(stdout: string): Theme {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim())
  } catch {
    throw new HostError('invalid-output', 'Shopify sent back a result the app could not read.')
  }
  const parsed = PushResultSchema.safeParse(value)
  if (!parsed.success) throw new HostError('invalid-output', 'Shopify sent back a result the app could not read.')
  return parsed.data.theme
}

export function createWriteGateway(deps: {
  storeId: string
  storeDomain: string
  records: Records
  listThemes: () => Promise<Theme[]>
  runPush: (cliArgs: readonly string[], themeDir: string) => Promise<string>
}) {
  const one = async (themeId: number): Promise<Theme> => {
    let themes: Theme[]
    try {
      themes = await deps.listThemes()
    } catch (err) {
      if (err instanceof HostError) throw err
      throw new HostError('cli-failed', "Couldn't reach your store. Please try again.", (err as Error).message)
    }
    const matches = themes.filter((theme) => theme.id === themeId)
    if (matches.length !== 1) throw new HostError('theme-not-found', 'That theme could not be found in your store. It may have been deleted.')
    return matches[0]!
  }

  const confirmRole = async (theme: Theme, pushed: readonly string[]) => {
    const after = await one(theme.id)
    if (after.role === theme.role) return after
    deps.records.retire(deps.storeId, theme.id)
    deps.records.saveIncident(randomUUID(), deps.storeId, theme.id, CHANGE_MESSAGES.roleChanged, pushed)
    throw new HostError('invalid-input', `${CHANGE_MESSAGES.roleChanged} Files sent: ${pushed.join(', ') || 'the theme'}.`)
  }

  const create = async (kind: ThemeKind, planKind: PushKind, treeDir: string, originThemeId: number | null, themeName?: string) => {
    const stdout = await deps.runPush(
      buildThemePushArgs({ kind: planKind, storeDomain: deps.storeDomain, themeName }),
      treeDir,
    )
    const theme = parsePushResult(stdout)
    const expected = planKind === 'create-development' ? ['development', 'unpublished'] : ['unpublished']
    if (!expected.includes(theme.role)) {
      deps.records.saveIncident(randomUUID(), deps.storeId, theme.id, CHANGE_MESSAGES.roleChanged, [])
      throw new HostError('invalid-input', CHANGE_MESSAGES.notWritable)
    }
    deps.records.saveOwnership({
      storeId: deps.storeId,
      themeId: theme.id,
      kind,
      name: theme.name,
      originThemeId,
      retired: false,
    })
    return confirmRole(theme, [])
  }

  const pushExisting = async (themeId: number, purpose: 'save' | 'preview', planKind: PushKind, treeDir: string, only?: readonly string[]) => {
    const before = await one(themeId)
    const record = deps.records.getOwnership(deps.storeId, themeId)
    if (!writeAllowed(before, record, purpose)) throw new HostError('invalid-input', CHANGE_MESSAGES.notWritable)
    const files = [...(only ?? [])]
    const stdout = await deps.runPush(
      buildThemePushArgs({ kind: planKind, storeDomain: deps.storeDomain, themeId, only: files }),
      treeDir,
    )
    const pushed = parsePushResult(stdout)
    if (pushed.id !== themeId) throw new HostError('invalid-output', 'Shopify updated a different theme than the one requested.')
    await confirmRole(before, files)
    return pushed
  }

  return {
    createWorkingCopy: (name: string, treeDir: string, originThemeId: number) =>
      create('working-copy', 'create-unpublished', treeDir, originThemeId, name),
    createPreview: (treeDir: string, mode: 'development' | 'fallback') =>
      create(
        'preview',
        mode === 'development' ? 'create-development' : 'create-unpublished',
        treeDir,
        null,
        mode === 'fallback' ? '[Builder] Preview' : undefined,
      ),
    mirrorPreview: (themeId: number, treeDir: string) => pushExisting(themeId, 'preview', 'mirror', treeDir),
    pushPreviewFiles: (themeId: number, treeDir: string, files: readonly string[]) =>
      pushExisting(themeId, 'preview', 'files', treeDir, files),
    pushSavedFiles: (themeId: number, treeDir: string, files: readonly string[]) =>
      pushExisting(themeId, 'save', 'files', treeDir, files),
  }
}

export function parseThemeListOrThrow(stdout: string): Theme[] {
  try {
    return parseThemeList(stdout)
  } catch (err) {
    throw new HostError('invalid-output', 'Shopify sent back a theme list the app could not read.', (err as Error).message)
  }
}
