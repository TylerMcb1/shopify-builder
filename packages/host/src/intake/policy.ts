// Theme path policy shared with the agent runner. Single source of truth: containers/agent/policy/*.json.
import { readFileSync } from 'node:fs'

export interface PathPolicy {
  allowed: readonly string[]
  blocked: readonly string[]
  sensitive: readonly string[]
}

const POLICY_DIR = new URL('../../../../containers/agent/policy/', import.meta.url)

const readList = (name: string): string[] => {
  const value: unknown = JSON.parse(readFileSync(new URL(name, POLICY_DIR), 'utf8'))
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error(`policy ${name} must be a string array`)
  return value
}

export function loadPathPolicy(): PathPolicy {
  return {
    allowed: readList('allowed-paths.json'),
    blocked: readList('blocked-files.json'),
    sensitive: readList('sensitive-files.json'),
  }
}

/** Minimal glob: `**` spans directories, `*` and `?` stay within one path segment. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(relPath: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(relPath))
}
