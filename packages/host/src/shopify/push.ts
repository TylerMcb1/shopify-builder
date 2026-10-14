// Shopify write argument lists and the role allowlist (README 9.1, 11).
// Callers never pass flags. This module is the only place those flags are chosen.
import { type Theme } from './schemas.ts'
import { type OwnershipRecord, type ThemeKind } from '../records/store.ts'
import { STORE_DOMAIN } from './schemas.ts'
import { isThemePath } from '../agent/protocol.ts'

const THEME_NAME = /^[A-Za-z0-9[][A-Za-z0-9 .[\]_-]{0,60}$/
const SAVE_KINDS = new Set<ThemeKind>(['working-copy', 'named-copy', 'adopted'])

export type PushKind = 'create-unpublished' | 'create-development' | 'mirror' | 'files'

export interface PushPlan {
  kind: PushKind
  storeDomain: string
  themeId?: number
  themeName?: string
  only?: readonly string[]
}

/** A theme may be written only when its current role and ownership record both agree. */
export function writeAllowed(theme: Theme, record: OwnershipRecord | null, purpose: 'save' | 'preview'): boolean {
  if (!record || record.retired || record.themeId !== theme.id) return false
  if (purpose === 'preview') {
    if (record.kind !== 'preview') return false
    return theme.role === 'development' || theme.role === 'unpublished'
  }
  if (theme.role !== 'unpublished') return false
  return SAVE_KINDS.has(record.kind)
}

export function buildThemePushArgs(plan: PushPlan): string[] {
  if (!STORE_DOMAIN.test(plan.storeDomain)) throw new Error('invalid store domain')
  const args = [
    'theme',
    'push',
    '--path',
    '/theme',
    '--store',
    plan.storeDomain,
    '--nodelete',
    '--json',
    '--no-color',
    '--no-input',
  ]
  if (plan.kind === 'create-unpublished') {
    if (!plan.themeName || !THEME_NAME.test(plan.themeName)) throw new Error('invalid theme name')
    return [...args, '--unpublished', '--theme', plan.themeName]
  }
  if (plan.kind === 'create-development') return [...args, '--development']
  if (!plan.themeId || !Number.isSafeInteger(plan.themeId) || plan.themeId <= 0) throw new Error('invalid theme id')
  args.push('--theme', String(plan.themeId))
  if (plan.kind === 'mirror') return args
  const only = plan.only ?? []
  if (only.length === 0) throw new Error('a save push lists the changed files')
  for (const file of only) {
    if (!isThemePath(file)) throw new Error('invalid theme file')
    args.push('--only', file)
  }
  return args
}
