// Per-step file checks before a turn is kept (README 14.1, 14.2, 12.5).
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { themeFileAccess } from '../agent/descriptions.ts'
import { intakeDirectory, type IntakeResult, type RejectedFile } from '../intake/intake.ts'
import { type PathPolicy } from '../intake/policy.ts'
import { isThemePath } from '../agent/protocol.ts'
import { type Offense } from './theme-check.ts'

export interface StepInspection {
  changed: { path: string; status: 'added' | 'modified' }[]
  /** Sensitive files that changed with no approval recorded for this step. */
  sensitiveUnapproved: string[]
  jsonProblems: Offense[]
  rejected: RejectedFile[]
  /** Canonical files missing from the workspace. They are restored, never pushed. */
  restored: string[]
  warnings: string[]
}

export async function inspectStep(opts: {
  workspace: string
  canonical: string
  policy: PathPolicy
  approvedSensitive: readonly string[]
}): Promise<StepInspection> {
  const [canonicalIntake, workspaceIntake] = await Promise.all([
    intakeDirectory(opts.canonical, opts.policy),
    intakeDirectory(opts.workspace, opts.policy),
  ])
  const canonicalFiles = new Map(canonicalIntake.accepted.map((file) => [file.path, file.data]))
  const workspaceFiles = new Map(workspaceIntake.accepted.map((file) => [file.path, file.data]))
  const approved = new Set(opts.approvedSensitive)
  const changed: StepInspection['changed'] = []
  const sensitiveUnapproved: string[] = []
  const jsonProblems: Offense[] = []

  for (const [rel, data] of workspaceFiles) {
    const previous = canonicalFiles.get(rel)
    const status = previous === undefined ? 'added' : previous.equals(data) ? null : 'modified'
    if (!status) continue
    changed.push({ path: rel, status })
    if (themeFileAccess(rel) === 'sensitive' && !approved.has(rel)) sensitiveUnapproved.push(rel)
    if (rel.endsWith('.json')) {
      try {
        JSON.parse(data.toString('utf8'))
      } catch {
        jsonProblems.push({
          check: 'JsonParse',
          file: rel,
          message: 'This file is not valid JSON.',
          severity: 'error',
        })
      }
    }
  }

  const restored: string[] = []
  for (const rel of canonicalFiles.keys()) {
    if (!workspaceFiles.has(rel)) restored.push(rel)
  }
  await writeBack(opts.workspace, restored, canonicalFiles)
  await dropRejected(opts.workspace, workspaceIntake, canonicalFiles)

  const warnings = [
    ...restored.map((file) => `I restored ${file}. Deleting theme files isn't part of this change.`),
    ...workspaceIntake.rejected.map((file) => `I left ${file.path} unchanged because it isn't an allowed theme file.`),
  ]
  return {
    changed,
    sensitiveUnapproved,
    jsonProblems,
    rejected: workspaceIntake.rejected,
    restored,
    warnings,
  }
}

/** Canonical files plus this step's accepted changes. The caller deletes the directory. */
export async function buildCandidate(opts: {
  canonical: string
  workspace: string
  policy: PathPolicy
  /** Paths whose workspace bytes must not be copied, for example a declined sensitive file. */
  skip: readonly string[]
}): Promise<{ dir: string; files: string[] }> {
  const [canonicalIntake, workspaceIntake] = await Promise.all([
    intakeDirectory(opts.canonical, opts.policy),
    intakeDirectory(opts.workspace, opts.policy),
  ])
  const skip = new Set(opts.skip)
  const files = new Map(canonicalIntake.accepted.map((file) => [file.path, file.data]))
  for (const file of workspaceIntake.accepted) {
    if (skip.has(file.path)) continue
    files.set(file.path, file.data)
  }
  const dir = path.join(path.dirname(opts.canonical), `.candidate-${randomBytes(6).toString('hex')}`)
  await mkdir(dir, { recursive: true })
  try {
    for (const [rel, data] of files) {
      if (!isThemePath(rel)) continue
      const dest = path.join(dir, ...rel.split('/'))
      if (!dest.startsWith(dir + path.sep)) throw new Error('path escapes candidate')
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, data, { flag: 'wx' })
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  return { dir, files: [...files.keys()].sort() }
}

async function writeBack(workspace: string, paths: readonly string[], files: Map<string, Buffer>): Promise<void> {
  for (const rel of paths) {
    const data = files.get(rel)
    if (!data || !isThemePath(rel)) continue
    const dest = path.join(workspace, ...rel.split('/'))
    if (!dest.startsWith(workspace + path.sep)) continue
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, data)
  }
}

async function dropRejected(
  workspace: string,
  workspaceIntake: IntakeResult,
  canonicalFiles: Map<string, Buffer>,
): Promise<void> {
  for (const rejected of workspaceIntake.rejected) {
    if (!isThemePath(rejected.path)) continue
    const dest = path.join(workspace, ...rejected.path.split('/'))
    if (!dest.startsWith(workspace + path.sep)) continue
    const original = canonicalFiles.get(rejected.path)
    if (original) await writeFile(dest, original)
    else await rm(dest, { force: true })
  }
}
