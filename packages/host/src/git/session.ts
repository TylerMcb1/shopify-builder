// Session branches, turn commits, drift merges, and the squash that becomes a saved change
// (README 12.2, 12.3, 13, 8.5). Git runs only on the host, through the hardened runner.
import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { listThemeFiles } from '../theme/files.ts'
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
  revertChange(
    gitDir: string,
    changeCommit: string,
    title: string,
  ): Promise<{ ok: true; commit: string; files: string[] } | { ok: false; files: string[] }>
  moveShopify(gitDir: string, next: string, expected: string): Promise<void>
  commitsAfter(gitDir: string, commit: string): Promise<string[]>
  snapshotCommit(gitDir: string, treeDir: string): Promise<string>
  mergeCommits(
    gitDir: string,
    base: string,
    ours: string,
    theirs: string,
  ): Promise<{ ok: true; commit: string } | { ok: false; files: string[] }>
  root(gitDir: string): Promise<string | null>
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
    async revertChange(gitDir, changeCommit, title) {
      if (!COMMIT.test(changeCommit)) throw new Error('invalid commit')
      const parent = await tip(gitDir, `${changeCommit}^`)
      const head = await tip(gitDir, SHOPIFY_REF)
      if (!parent || !head) return { ok: false, files: [] }
      const ancestor = await git.run(gitDir, ['merge-base', '--is-ancestor', changeCommit, SHOPIFY_REF], { okExitCodes: [1] })
      if (ancestor.exitCode !== 0) return { ok: false, files: [] }
      const introduced = parseNameStatus(
        (await git.run(gitDir, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', parent, changeCommit])).stdout,
      )
      const current = await lsTree(git, gitDir, head)
      const next = new Map(current)
      const conflicts: string[] = []
      for (const change of introduced) {
        const now = current.get(change.path) ?? null
        const then = await blobAt(git, gitDir, changeCommit, change.path)
        const before = await blobAt(git, gitDir, parent, change.path)
        if (change.status === 'added') {
          if (now === null) continue
          if (now !== then) conflicts.push(change.path)
          else next.delete(change.path)
        } else if (now !== then) {
          conflicts.push(change.path)
        } else if (before) {
          next.set(change.path, before)
        } else {
          next.delete(change.path)
        }
      }
      if (conflicts.length > 0) return { ok: false, files: conflicts }
      const tree = await writeTree(git, gitDir, next)
      const commit = (await text(gitDir, ['commit-tree', tree, '-p', head, '-m', `revert: ${title}`])).trim()
      await git.run(gitDir, ['update-ref', SHOPIFY_REF, commit, head])
      return { ok: true, commit, files: introduced.map((change) => change.path) }
    },
    async moveShopify(gitDir, next, expected) {
      if (!COMMIT.test(next) || !COMMIT.test(expected)) throw new Error('invalid commit')
      await git.run(gitDir, ['update-ref', SHOPIFY_REF, next, expected])
    },
    async commitsAfter(gitDir, commit) {
      if (!COMMIT.test(commit)) throw new Error('invalid commit')
      const out = await text(gitDir, ['rev-list', `${commit}..${SHOPIFY_REF}`])
      return out ? out.split('\n').filter(Boolean) : []
    },
    async snapshotCommit(gitDir, treeDir) {
      const files = await listThemeFiles(treeDir)
      if (files.length === 0) throw new Error('theme has no files')
      const tree = await treeForFiles(gitDir, treeDir, files)
      return text(gitDir, ['commit-tree', tree, '-m', 'snapshot'])
    },
    async mergeCommits(gitDir, base, ours, theirs) {
      for (const commit of [base, ours, theirs]) {
        if (!COMMIT.test(commit)) throw new Error('invalid commit')
      }
      const result = await git.run(
        gitDir,
        ['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, ours, theirs],
        { okExitCodes: [1] },
      )
      const lines = result.stdout
        .toString('utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const tree = lines[0] ?? ''
      if (!COMMIT.test(tree)) throw new Error('merge produced no tree')
      if (result.exitCode !== 0) return { ok: false, files: lines.slice(1) }
      const commit = await text(gitDir, ['commit-tree', tree, '-p', ours, '-m', 'merge: live theme'])
      return { ok: true, commit }
    },
    async root(gitDir) {
      const out = await text(gitDir, ['rev-list', '--max-parents=0', SHOPIFY_REF])
      const commit = out.split('\n').filter(Boolean)[0] ?? ''
      return COMMIT.test(commit) ? commit : null
    },
  }
}

async function blobAt(git: Git, gitDir: string, rev: string, file: string): Promise<string | null> {
  const result = await git.run(gitDir, ['rev-parse', '--verify', '--quiet', `${rev}:${file}`], { okExitCodes: [1] })
  const value = result.stdout.toString('utf8').trim()
  return value || null
}

const COMMIT = /^[0-9a-f]{40,64}$/

async function writeTree(git: Git, gitDir: string, entries: Map<string, string>): Promise<string> {
  const indexFile = path.join(path.dirname(gitDir), `.index-${randomBytes(6).toString('hex')}`)
  try {
    const records = [...entries.entries()].map(([file, hash]) => `100644 ${hash}\t${file}\0`).join('')
    if (records) await git.run(gitDir, ['update-index', '-z', '--index-info'], { stdin: records, indexFile })
    else await git.run(gitDir, ['read-tree', '--empty'], { indexFile })
    return (await git.run(gitDir, ['write-tree'], { indexFile })).stdout.toString('utf8').trim()
  } finally {
    await rm(indexFile, { force: true })
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
