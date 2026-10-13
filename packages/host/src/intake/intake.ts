// File intake for files entering trusted storage from a Shopify pull (README 14.1).
// Scans what is actually on disk. Accepted files are returned as buffers read once through a
// no-follow handle, so nothing can be swapped between checking a file and storing it.
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { containsCredential } from '../redact.ts'
import { matchesAny, type PathPolicy } from './policy.ts'

export type RejectReason =
  | 'dotfile'
  | 'not-regular-file'
  | 'hard-link'
  | 'outside-allowed-paths'
  | 'blocked-file'
  | 'invalid-name'
  | 'case-collision'
  | 'too-deep'
  | 'too-large'
  | 'unsupported-type'
  | 'invalid-utf8'
  | 'credential-like-content'

export interface AcceptedFile {
  /** Forward-slash path relative to the theme root, e.g. "sections/header.liquid". */
  path: string
  data: Buffer
  sensitive: boolean
}

export interface RejectedFile {
  path: string
  reason: RejectReason
}

export interface IntakeResult {
  accepted: AcceptedFile[]
  rejected: RejectedFile[]
}

export interface IntakeLimits {
  maxTextBytes: number
  maxBinaryBytes: number
  maxFiles: number
  maxTotalBytes: number
  maxDepth: number
}

export const DEFAULT_LIMITS: IntakeLimits = {
  maxTextBytes: 2 * 1024 * 1024,
  maxBinaryBytes: 20 * 1024 * 1024,
  maxFiles: 5000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxDepth: 6,
}

const TEXT_EXTENSIONS = new Set(['.liquid', '.json', '.css', '.js', '.svg', '.scss', '.txt', '.md', '.map'])
// Binary types are only accepted under assets/.
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.pdf'])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const BAD_NAME_CHARS = /[\u0000-\u001f<>:"\\|?*]/
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0

export class IntakeLimitError extends Error {}

function nameProblem(name: string): RejectReason | null {
  if (name.startsWith('.')) return 'dotfile'
  if (name.length > 255 || BAD_NAME_CHARS.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED.test(name)) return 'invalid-name'
  return null
}

export async function intakeDirectory(root: string, policy: PathPolicy, limits: IntakeLimits = DEFAULT_LIMITS): Promise<IntakeResult> {
  const accepted: AcceptedFile[] = []
  const rejected: RejectedFile[] = []
  const seenLower = new Map<string, string>()
  let totalBytes = 0
  let fileCount = 0

  const walk = async (dirAbs: string, relParts: string[]): Promise<void> => {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const parts = [...relParts, entry.name]
      const rel = parts.join('/')
      const abs = path.join(dirAbs, entry.name)

      if (++fileCount > limits.maxFiles) throw new IntakeLimitError('too many files')
      const problem = nameProblem(entry.name)
      if (problem) {
        rejected.push({ path: rel, reason: problem })
        continue
      }
      const st = await fs.lstat(abs)
      if (st.isDirectory()) {
        if (parts.length >= limits.maxDepth) rejected.push({ path: rel, reason: 'too-deep' })
        else await walk(abs, parts)
        continue
      }
      if (!st.isFile()) {
        rejected.push({ path: rel, reason: 'not-regular-file' })
        continue
      }
      const reason = await checkAndRead(abs, rel, st.size)
      if (typeof reason === 'string') rejected.push({ path: rel, reason })
      else {
        totalBytes += reason.data.length
        if (totalBytes > limits.maxTotalBytes) throw new IntakeLimitError('theme too large')
        accepted.push(reason)
      }
    }
  }

  const checkAndRead = async (abs: string, rel: string, size: number): Promise<RejectReason | AcceptedFile> => {
    if (!matchesAny(rel, policy.allowed) || !rel.includes('/')) return 'outside-allowed-paths'
    if (matchesAny(rel, policy.blocked)) return 'blocked-file'

    const lower = rel.toLowerCase()
    if (seenLower.has(lower)) return 'case-collision'
    seenLower.set(lower, rel)

    const ext = path.posix.extname(rel).toLowerCase()
    const isText = TEXT_EXTENSIONS.has(ext)
    const isBinary = !isText && BINARY_EXTENSIONS.has(ext) && rel.startsWith('assets/')
    if (!isText && !isBinary) return 'unsupported-type'
    const max = isText ? limits.maxTextBytes : limits.maxBinaryBytes
    if (size > max) return 'too-large'

    const handle = await fs.open(abs, constants.O_RDONLY | O_NOFOLLOW)
    let data: Buffer
    try {
      const st = await handle.stat()
      if (!st.isFile()) return 'not-regular-file'
      if (st.nlink > 1) return 'hard-link'
      if (st.size > max) return 'too-large'
      data = await handle.readFile()
    } finally {
      await handle.close()
    }
    if (data.length > max) return 'too-large'

    if (isText) {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      } catch {
        return 'invalid-utf8'
      }
      if (containsCredential(text)) return 'credential-like-content'
    }
    return { path: rel, data, sensitive: matchesAny(rel, policy.sensitive) }
  }

  await walk(root, [])
  return { accepted, rejected }
}
