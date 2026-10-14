// Sensitive-file descriptions shown in the approval pop-up (README 10.4).
// The text comes from the policy file, never from the agent container.
import { readFileSync } from 'node:fs'
import { globToRegExp, loadPathPolicy, matchesAny, type PathPolicy } from '../intake/policy.ts'

export type ThemeFileAccess = 'blocked' | 'outside' | 'sensitive' | 'allowed'

interface ThemeRules {
  policy: PathPolicy
  descriptions: Record<string, string>
}

let cached: ThemeRules | undefined

export function loadThemeRules(): ThemeRules {
  if (cached) return cached
  const policy = loadPathPolicy()
  const value: unknown = JSON.parse(readFileSync(new URL('../../../../containers/agent/policy/sensitive-descriptions.json', import.meta.url), 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sensitive descriptions must be an object')
  const descriptions: Record<string, string> = {}
  for (const glob of policy.sensitive) {
    const text = (value as Record<string, unknown>)[glob]
    if (typeof text !== 'string' || text.length === 0) throw new Error(`missing description for ${glob}`)
    descriptions[glob] = text
  }
  cached = { policy, descriptions }
  return cached
}

export function themeFileAccess(relPath: string): ThemeFileAccess {
  const { policy } = loadThemeRules()
  if (matchesAny(relPath, policy.blocked)) return 'blocked'
  if (!matchesAny(relPath, policy.allowed)) return 'outside'
  if (matchesAny(relPath, policy.sensitive)) return 'sensitive'
  return 'allowed'
}

export function describeThemeFile(relPath: string): string | null {
  const { policy, descriptions } = loadThemeRules()
  for (const glob of policy.sensitive) {
    if (globToRegExp(glob).test(relPath)) return descriptions[glob] ?? null
  }
  return null
}
