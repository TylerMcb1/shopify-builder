// Path checks for the agent runner (README 6.2, 10.2, 10.4).
// These are an early warning. The host's file intake is what actually accepts a file.
// Glob rules match packages/host/src/intake/policy.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep']
const MUTATING = new Set(['Write', 'Edit'])
const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit'])

export const DECLINE_MESSAGE =
  'The user declined changes to those files. Complete the request without changing them, or explain why you cannot.'

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
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

export function matchesAny(relPath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(relPath))
}

function readList(dir, name) {
  const value = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`policy ${name} must be a string array`)
  }
  return value
}

export function loadPolicy(policyDir) {
  const allowed = readList(policyDir, 'allowed-paths.json')
  const blocked = readList(policyDir, 'blocked-files.json')
  const sensitive = readList(policyDir, 'sensitive-files.json')
  const descriptions = JSON.parse(readFileSync(path.join(policyDir, 'sensitive-descriptions.json'), 'utf8'))
  if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions)) {
    throw new Error('sensitive descriptions must be an object')
  }
  for (const glob of sensitive) {
    if (typeof descriptions[glob] !== 'string' || descriptions[glob].length === 0) {
      throw new Error(`missing description for ${glob}`)
    }
  }
  return { allowed, blocked, sensitive, descriptions }
}

export function isThemePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('//')) return false
  return value.split('/').every((part) => {
    if (part.length === 0 || part === '.' || part === '..' || part.startsWith('.')) return false
    return /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(part)
  })
}

export function describeThemeFile(relPath, policy) {
  for (const glob of policy.sensitive) {
    if (globToRegExp(glob).test(relPath)) return policy.descriptions[glob]
  }
  return null
}

/** Turn a tool path into a theme-relative path, or null when it leaves the workspace. */
export function toThemePath(inputPath, workspaceRoot) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.length > 500) return null
  if (inputPath.includes('\0')) return null
  const root = path.resolve(workspaceRoot)
  const abs = path.resolve(root, inputPath)
  const rel = path.relative(root, abs)
  if (rel === '') return ''
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const posix = rel.split(path.sep).join('/')
  if (posix.split('/').some((part) => part === '..' || part.startsWith('.'))) return null
  return posix
}

/**
 * @returns {{ behavior: 'allow', mutating?: boolean } | { behavior: 'deny', message: string } | { behavior: 'approve', files: { path: string, description: string }[] }}
 */
export function decideToolUse({ toolName, input, workspaceRoot, policy, alreadyApproved }) {
  if (!FILE_TOOLS.includes(toolName)) {
    return { behavior: 'deny', message: 'That tool is not available in Shopify Builder.' }
  }
  const raw = FILE_PATH_TOOLS.has(toolName) ? input?.file_path : (input?.path ?? workspaceRoot)
  const rel = toThemePath(raw, workspaceRoot)
  if (rel === null) return { behavior: 'deny', message: 'That path is outside the theme workspace.' }
  if (rel === '') {
    if (toolName === 'Glob' || toolName === 'Grep') return { behavior: 'allow' }
    return { behavior: 'deny', message: 'That path is outside the allowed theme files.' }
  }
  if (!isThemePath(rel) || matchesAny(rel, policy.blocked)) {
    return { behavior: 'deny', message: 'That file is blocked and cannot be changed.' }
  }
  if (!matchesAny(rel, policy.allowed)) {
    return { behavior: 'deny', message: 'That path is outside the allowed theme files.' }
  }
  if (MUTATING.has(toolName) && matchesAny(rel, policy.sensitive) && !alreadyApproved.has(rel)) {
    return {
      behavior: 'approve',
      files: [{ path: rel, description: describeThemeFile(rel, policy) }],
    }
  }
  return { behavior: 'allow', mutating: MUTATING.has(toolName) }
}
