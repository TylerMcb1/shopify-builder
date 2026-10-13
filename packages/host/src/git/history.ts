// Git history service: `sync` commits on the `shopify` branch (README 8.2, 12.1-12.3, 13).
// A sync commit is built with a temporary index from a tree of files that already passed intake,
// so it never touches canonical/ or any session checkout.
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Theme } from '../shopify/schemas.ts'
import type { Git } from './git.ts'

export const SHOPIFY_BRANCH = 'shopify'
export const SHOPIFY_REF = `refs/heads/${SHOPIFY_BRANCH}`

export type FileChangeStatus = 'added' | 'modified' | 'deleted'

export interface SyncInput {
  /** history.git/ for this theme (outside every working tree). */
  gitDir: string
  /** Directory holding exactly the accepted files; read by Git, never modified. */
  treeDir: string
  /** Forward-slash paths relative to treeDir. */
  files: readonly string[]
  /** The Shopify theme the files were pulled from; recorded in the commit title and tag. */
  source: Pick<Theme, 'id' | 'role'>
}

export interface SyncResult {
  /** False when Shopify matched the current `shopify` branch, so no commit was made. */
  created: boolean
  /** Commit at the tip of `shopify` after the sync. */
  commit: string
  parent: string | null
  tag: string | null
  title: string | null
  changes: { path: string; status: FileChangeStatus }[]
}

export class SyncConflictError extends Error {}

const STATUS: Record<string, FileChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', T: 'modified' }

export function createHistoryService(git: Git) {
  const text = async (gitDir: string, args: string[], opts?: Parameters<Git['run']>[2]) =>
    (await git.run(gitDir, args, opts)).stdout.toString('utf8').trim()

  async function ensureRepository(gitDir: string): Promise<void> {
    const exists = await fs.stat(gitDir).then(() => true, () => false)
    if (!exists) {
      await fs.mkdir(path.dirname(gitDir), { recursive: true })
      await git.initBare(gitDir, SHOPIFY_BRANCH)
    }
    if ((await text(gitDir, ['rev-parse', '--is-bare-repository'])) !== 'true') throw new Error('history.git is not a bare repository')
  }

  async function resolveCommit(gitDir: string, rev: string): Promise<string | null> {
    const r = await git.run(gitDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { okExitCodes: [1] })
    return r.exitCode === 0 ? r.stdout.toString('utf8').trim() : null
  }

  async function recordSync(input: SyncInput): Promise<SyncResult> {
    const { gitDir, treeDir, source } = input
    await ensureRepository(gitDir)
    const files = [...input.files].sort()
    for (const f of files) {
      if (!f || f.includes('\n') || f.includes('\0') || f.startsWith('/') || f.split('/').some((p) => p === '' || p === '.' || p === '..')) {
        throw new Error('invalid file path for sync')
      }
    }

    const parent = await resolveCommit(gitDir, SHOPIFY_REF)

    const absolute = files.map((f) => path.join(treeDir, ...f.split('/')))
    const hashes = files.length
      ? (await text(gitDir, ['hash-object', '-w', '--no-filters', '--stdin-paths'], { stdin: absolute.join('\n') + '\n' })).split('\n')
      : []
    if (hashes.length !== files.length) throw new Error('git hash-object returned an unexpected number of objects')

    const indexFile = path.join(path.dirname(gitDir), `.sync-index-${randomBytes(6).toString('hex')}`)
    let tree: string
    try {
      const records = files.map((f, i) => `100644 ${hashes[i]}\t${f}\0`).join('')
      await git.run(gitDir, ['update-index', '-z', '--index-info'], { stdin: records, indexFile })
      tree = await text(gitDir, ['write-tree'], { indexFile })
    } finally {
      await fs.rm(indexFile, { force: true })
    }

    const parentTree = parent ? await text(gitDir, ['rev-parse', `${parent}^{tree}`]) : null
    if (parent && parentTree === tree) return { created: false, commit: parent, parent, tag: null, title: null, changes: [] }

    const changes = parentTree
      ? parseNameStatus((await git.run(gitDir, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', parentTree, tree])).stdout)
      : files.map((f) => ({ path: f, status: 'added' as const }))

    const title = parent ? changeTitle(changes) : `sync: pulled ${source.role} theme ${source.id}`
    const commit = await text(gitDir, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', title])

    // Compare-and-swap: fails if anything else moved the branch since `parent` was read.
    try {
      await git.run(gitDir, ['update-ref', '-m', title, SHOPIFY_REF, commit, parent ?? ''])
    } catch {
      throw new SyncConflictError('shopify branch changed during sync')
    }

    const tagPrefix = `refs/tags/sync/${source.id}/`
    const existing = (await text(gitDir, ['for-each-ref', '--format=%(refname)', tagPrefix])).split('\n').filter(Boolean)
    const tag = `${tagPrefix}${existing.length + 1}`
    await git.run(gitDir, ['update-ref', tag, commit, ''])

    return { created: true, commit, parent, tag: tag.slice('refs/tags/'.length), title, changes }
  }

  return { ensureRepository, recordSync, resolveCommit }
}

export type HistoryService = ReturnType<typeof createHistoryService>

function parseNameStatus(out: Buffer): SyncResult['changes'] {
  const parts = out.toString('utf8').split('\0').filter(Boolean)
  const changes: SyncResult['changes'] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changes.push({ status: STATUS[parts[i]!] ?? 'modified', path: parts[i + 1]! })
  }
  return changes
}

function changeTitle(changes: SyncResult['changes']): string {
  if (changes.length === 1) return `sync: changes on Shopify detected in ${changes[0]!.path}`
  return `sync: changes on Shopify detected in ${changes.length} files`
}
