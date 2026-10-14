// Session workspace on the host (README 6.1, 6.2). Files are copied in; nothing is mounted from Git.
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HostError } from '../errors.ts'
import { type SessionPaths } from '../store/layout.ts'

export async function prepareSessionWorkspace(opts: {
  canonicalDir: string
  paths: SessionPaths
  themeId: number
  storeId: string
  resume: boolean
}): Promise<void> {
  if (!path.isAbsolute(opts.canonicalDir)) {
    throw new HostError('invalid-input', 'Pull this theme before starting a change.')
  }
  if (opts.resume) {
    const meta = await readMeta(opts.paths.meta)
    if (!meta || meta.themeId !== opts.themeId || meta.storeId !== opts.storeId) {
      throw new HostError('invalid-input', 'That change session is no longer on this computer.')
    }
    await mkdir(opts.paths.workspace, { recursive: true })
    await mkdir(opts.paths.agentState, { recursive: true })
    return
  }
  await mkdir(opts.paths.workspace, { recursive: true })
  const existing = await readdir(opts.paths.workspace)
  if (existing.length > 0) throw new HostError('busy', 'A change session is already using this workspace.')
  await copyThemeFiles(opts.canonicalDir, opts.paths.workspace)
  await mkdir(opts.paths.agentState, { recursive: true })
  const meta = JSON.stringify({ storeId: opts.storeId, themeId: opts.themeId }) + '\n'
  await writeFile(opts.paths.meta, meta, { mode: 0o600 })
}

export async function discardSessionDir(paths: SessionPaths): Promise<void> {
  await rm(paths.sessionDir, { recursive: true, force: true })
}

async function readMeta(file: string): Promise<{ storeId: string; themeId: number } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const storeId = (parsed as { storeId?: unknown }).storeId
    const themeId = (parsed as { themeId?: unknown }).themeId
    if (typeof storeId !== 'string' || typeof themeId !== 'number') return null
    return { storeId, themeId }
  } catch {
    return null
  }
}

async function copyThemeFiles(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const source = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      await mkdir(dest, { recursive: true })
      await copyThemeFiles(source, dest)
      continue
    }
    // A hard link can point at a file outside the theme. Skip it.
    if (!stat.isFile() || stat.nlink > 1) continue
    await copyFile(source, dest)
  }
}
