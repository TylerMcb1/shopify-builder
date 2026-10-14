// Session branches, turn commits, drift merges, and the squash that becomes a saved change
// (README 12.2, 12.3, 13, 8.5). Git runs only on the host, through the hardened runner.
import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { type Git } from './git.ts'
import { SHOPIFY_REF, type FileChangeStatus } from './history.ts'

const SESSION_ID = /^[a-z0-9][a-z0-9-]{7,63}$/

export function sessionRef(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('invalid session id')
  return `refs/heads/session/${sessionId}`
}

export function shortTitle(text: string): string {
  const line = text.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim()
  return (line.slice(0, 72) || 'theme change').trim()
}

export interface SessionHistory {
  ensureBranch(gitDir: string, sessionId: string): Promise<{ commit: string; created: boolean }>
  commitTurn(gitDir: string, sessionId: string, treeDir: string, files: readonly string[], title: string): Promise<string>
  diff(gitDir: string, from: string, to: string): Promise<{ path: string; status: FileChangeStatus }[]>
  mergeShopify(gitDir: string, sessionId: string): Promise<'clean' | 'conflict'>
  commitChange(gitDir: string, sessionId: string, base: string, title: string): Promise<{ commit: string; files: string[] }>
  undoTurn(gitDir: string, sessionId: string, base: string): Promise<string | null>
  deleteBranch(gitDir: string, sessionId: string): Promise<void>
  materialize(gitDir: string, rev: string, dest: string): Promise<void>
  tip(gitDir: string, rev: string): Promise<string | null>
}

export function createSessionHistory(git: Git): SessionHistory {
  const text = async (gitDir: string, args: string[], opts?: Parameters<Git['run']>[2]) =>
    (await git.run(gitDir, args, opts)).stdout.toString('utf8').trim()

  async function tip(gitDir: string, rev: string): Promise<string | null> {
    const result = await git.run(gitDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { okExitCodes: [1] })
    return result.exitCode === 0 ? result.stdout.toString('utf8').trim() : null
  }

  async function treeForFiles(gitDir: string, treeDir: string, files: readonly string[]): Promise<string> {
    const sorted = [...files].sort()
    for (const file of sorted) assertPath(file)
    const absolute = sorted.map((file) => path.join(treeDir, ...file.split('/')))
    const hashes = sorted.length
      ? (await text(gitDir, ['hash-object', '-w', '--no-filters', '--stdin-paths'], { stdin: absolute.join('\n') + '\n' })).split('\n')
      : []
    if (hashes.length !== sorted.length) throw new Error('git hash-object returned an unexpected number of objects')
    const indexFile = path.join(path.dirname(gitDir), `.index-${randomBytes(6).toString('hex')}`)
    try {
      const records = sorted.map((file, index) => `100644 ${hashes[index]}\t${file}\0`).join('')
      await git.run(gitDir, ['update-index', '-z', '--index-info'], { stdin: records, indexFile })
      return await text(gitDir, ['write-tree'], { indexFile })
    } finally {
      await rm(indexFile, { force: true })
    }
  }

  return {
    tip,
    async ensureBranch(gitDir, sessionId) {
      const ref = sessionRef(sessionId)
      const existing = await tip(gitDir, ref)
      if (existing) return { commit: existing, created: false }
      const shopify = await tip(gitDir, SHOPIFY_REF)
      if (!shopify) throw new Error('no shopify history')
      await git.run(gitDir, ['update-ref', ref, shopify, ''])
      return { commit: shopify, created: true }
    },
    async commitTurn(gitDir, sessionId, treeDir, files, title) {
      const ref = sessionRef(sessionId)
      const parent = await tip(gitDir, ref)
      if (!parent) throw new Error('session branch is missing')
      const tree = await treeForFiles(gitDir, treeDir, files)
      const parentTree = await text(gitDir, ['rev-parse', `${parent}^{tree}`])
      if (parentTree === tree) return parent
      const message = `turn: ${shortTitle(title)}`
      const commit = await text(gitDir, ['commit-tree', tree, '-p', parent, '-m', message])
      await git.run(gitDir, ['update-ref', '-m', message, ref, commit, parent])
      return commit
    },
    async diff(gitDir, from, to) {
      const out = (await git.run(gitDir, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', from, to])).stdout
      return parseNameStatus(out)
    },
    async mergeShopify(gitDir, sessionId) {
      const ref = sessionRef(sessionId)
      const sessionTip = await tip(gitDir, ref)
      const shopifyTip = await tip(gitDir, SHOPIFY_REF)
      if (!sessionTip || !shopifyTip) throw new Error('missing branch')
      if (sessionTip === shopifyTip) return 'clean'
      const merged = await git.run(gitDir, ['merge-tree', '--write-tree', ref, SHOPIFY_REF], { okExitCodes: [1] })
      if (merged.exitCode !== 0) return 'conflict'
      const tree = merged.stdout.toString('utf8').trim().split('\n')[0]
      if (!tree || !/^[0-9a-f]{40,64}$/.test(tree)) throw new Error('merge did not return a tree')
      const message = 'merge: Shopify edits into this change'
      const commit = await text(gitDir, ['commit-tree', tree, '-p', sessionTip, '-p', shopifyTip, '-m', message])
      await git.run(gitDir, ['update-ref', '-m', message, ref, commit, sessionTip])
      return 'clean'
    },
    async commitChange(gitDir, sessionId, base, title) {
      const ref = sessionRef(sessionId)
      const sessionTip = await tip(gitDir, ref)
      const shopifyTip = await tip(gitDir, SHOPIFY_REF)
      if (!sessionTip || !shopifyTip) throw new Error('missing branch')
      const changes = await this.diff(gitDir, base, sessionTip)
      const files = changes.filter((change) => change.status !== 'deleted').map((change) => change.path)
      const entries = await lsTree(git, gitDir, shopifyTip)
      for (const file of files) {
        entries.set(file, await text(gitDir, ['rev-parse', `${sessionTip}:${file}`]))
      }
      const indexFile = path.join(path.dirname(gitDir), `.index-${randomBytes(6).toString('hex')}`)
      let tree: string
      try {
        const records = [...entries.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([file, hash]) => `100644 ${hash}\t${file}\0`)
          .join('')
        await git.run(gitDir, ['update-index', '-z', '--index-info'], { stdin: records, indexFile })
        tree = await text(gitDir, ['write-tree'], { indexFile })
      } finally {
        await rm(indexFile, { force: true })
      }
      const message = `change: ${shortTitle(title)}`
      const commit = await text(gitDir, ['commit-tree', tree, '-p', shopifyTip, '-m', message])
      await git.run(gitDir, ['update-ref', '-m', message, SHOPIFY_REF, commit, shopifyTip])
      await git.run(gitDir, ['update-ref', '-d', ref])
      return { commit, files }
    },
    async undoTurn(gitDir, sessionId, base) {
      const ref = sessionRef(sessionId)
      const current = await tip(gitDir, ref)
      if (!current || current === base) return null
      const parent = await tip(gitDir, `${current}^`)
      if (!parent) return null
      await git.run(gitDir, ['update-ref', ref, parent, current])
      return parent
    },
    async deleteBranch(gitDir, sessionId) {
      const ref = sessionRef(sessionId)
      if (await tip(gitDir, ref)) await git.run(gitDir, ['update-ref', '-d', ref])
    },
    async materialize(gitDir, rev, dest) {
      await rm(dest, { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      const indexFile = path.join(path.dirname(gitDir), `.index-${randomBytes(6).toString('hex')}`)
      try {
        await git.run(gitDir, ['read-tree', rev], { indexFile })
        // history.git is bare, so checkout-index needs an explicit work tree.
        await git.run(gitDir, ['--work-tree', dest, 'checkout-index', '-a', '-f'], { indexFile })
      } finally {
        await rm(indexFile, { force: true })
      }
    },
  }
}

function assertPath(file: string): void {
  if (!file || file.includes('\n') || file.includes('\0') || file.startsWith('/') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('invalid file path')
  }
}

const STATUS: Record<string, FileChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', T: 'modified' }

function parseNameStatus(out: Buffer): { path: string; status: FileChangeStatus }[] {
  const parts = out.toString('utf8').split('\0').filter(Boolean)
  const changes: { path: string; status: FileChangeStatus }[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changes.push({ status: STATUS[parts[i]!] ?? 'modified', path: parts[i + 1]! })
  }
  return changes
}

async function lsTree(git: Git, gitDir: string, rev: string): Promise<Map<string, string>> {
  const out = (await git.run(gitDir, ['ls-tree', '-r', '-z', rev])).stdout
  const entries = new Map<string, string>()
  for (const record of out.toString('utf8').split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const meta = record.slice(0, tab).split(' ')
    const file = record.slice(tab + 1)
    const hash = meta[2]
    if (hash && file) entries.set(file, hash)
  }
  return entries
}
