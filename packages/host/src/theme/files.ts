// Theme files the app is willing to compare (README 8.6, 11). Hidden files stay out.
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOTS = new Set(['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'])

export async function listThemeFiles(dir: string): Promise<string[]> {
  try {
    if (!(await stat(dir)).isDirectory()) return []
  } catch {
    return []
  }
  const found: string[] = []
  const walk = async (current: string, prefix: string) => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!prefix && !ROOTS.has(entry.name)) continue
        await walk(path.join(current, entry.name), rel)
      } else if (entry.isFile() && prefix) {
        found.push(rel)
      }
    }
  }
  await walk(dir, '')
  return found.sort()
}

export async function hashTheme(dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  for (const file of await listThemeFiles(dir)) {
    const bytes = await readFile(path.join(dir, ...file.split('/')))
    hashes.set(file, createHash('sha256').update(bytes).digest('hex'))
  }
  return hashes
}

export function diffHashes(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): string[] {
  const paths = new Set([...left.keys(), ...right.keys()])
  return [...paths].filter((file) => left.get(file) !== right.get(file)).sort()
}

export interface FileMergePlan {
  takeLive: string[]
  conflicts: string[]
}

/** Whole-file three-way merge. A file both sides changed differently is a conflict. */
export function planFileMerge(
  origin: ReadonlyMap<string, string>,
  working: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, string>,
): FileMergePlan {
  const paths = new Set([...origin.keys(), ...working.keys(), ...live.keys()])
  const takeLive: string[] = []
  const conflicts: string[] = []
  for (const file of [...paths].sort()) {
    const base = origin.get(file)
    const ours = working.get(file)
    const theirs = live.get(file)
    if (theirs === ours) continue
    if (theirs === base) continue
    if (ours === base) takeLive.push(file)
    else conflicts.push(file)
  }
  return { takeLive, conflicts }
}

export function filesToTakeFromLive(plan: FileMergePlan, choice: 'live' | 'working'): string[] {
  return choice === 'live' ? [...plan.takeLive, ...plan.conflicts] : [...plan.takeLive]
}
