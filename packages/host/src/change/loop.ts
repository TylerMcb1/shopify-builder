// After each model step: intake, Theme Check, repair, preview, and save (README 8.3–8.5, 10.5, 13, 14).
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { describeThemeFile } from '../agent/descriptions.ts'
import { type AgentSession } from '../agent/session.ts'
import {
  PROGRESS_LABELS,
  SessionEventSchema,
  type SessionBody,
  type SessionCommandResult,
  type SessionEvent,
} from '../agent/protocol.ts'
import { HostError } from '../errors.ts'
import { loadPathPolicy } from '../intake/policy.ts'
import { SHOPIFY_REF, type SyncResult } from '../git/history.ts'
import { type SessionHistory, shortTitle } from '../git/session.ts'
import { type Records } from '../records/store.ts'
import { type Theme } from '../shopify/schemas.ts'
import { buildCandidate, inspectStep } from '../validation/step.ts'
import { compareThemeCheck, isParseOffense, type Offense } from '../validation/theme-check.ts'
import { pagesToCapture, type PreviewPage } from '../preview/url.ts'
import { CHANGE_MESSAGES } from './messages.ts'

type StepEvent = Extract<SessionEvent, { type: 'step_result' }>

export interface ChangePorts {
  runThemeCheck: (dir: string) => Promise<Offense[]>
  syncTheme: () => Promise<SyncResult>
  pushPreview: (mode: 'mirror' | 'files', files: readonly string[], treeDir: string) => Promise<number | void>
  pushSave: (files: readonly string[], treeDir: string) => Promise<Theme>
  capture?: (pages: PreviewPage[], when: 'before' | 'after') => Promise<void>
}

export function createChangeLoop(opts: {
  storeId: string
  themeId: number
  storeDomain: string
  sessionId: string
  workspace: string
  canonical: string
  gitDir: string
  baseCommit: string
  send: (event: SessionEvent) => void
  session: AgentSession
  history: SessionHistory
  records: Records
  ports: ChangePorts
}) {
  const policy = loadPathPolicy()
  let seq = 0
  let base = opts.baseCommit
  let lastGood = opts.baseCommit
  let title = 'theme change'
  let validated = false
  let confirming = false
  const approved = new Set<string>()
  let backstop: { requestId: string; resolve: (decision: 'approve' | 'decline') => void } | null = null

  const emit = (body: SessionBody) => {
    seq += 1
    opts.send(SessionEventSchema.parse({ sessionId: opts.sessionId, seq, ...body }))
  }

  const progress = (stage: keyof typeof PROGRESS_LABELS) => {
    emit({ type: 'progress', stage, label: PROGRESS_LABELS[stage] })
  }

  const themeKey = `${opts.storeId}:${opts.themeId}`

  async function restore(rev: string) {
    await opts.history.materialize(opts.gitDir, rev, opts.canonical)
    await opts.history.materialize(opts.gitDir, rev, opts.workspace)
  }

  async function baselineFor(commit: string, tree: string): Promise<Offense[]> {
    const stored = opts.records.getBaseline(commit)
    if (stored) return stored
    const offenses = await opts.ports.runThemeCheck(tree)
    opts.records.saveBaseline(commit, offenses)
    return offenses
  }

  async function afterStep(event: StepEvent): Promise<void> {
    try {
      progress('checking')
      for (const file of event.sensitiveApproved) approved.add(file)
      let inspection = await inspectStep({
        workspace: opts.workspace,
        canonical: opts.canonical,
        policy,
        approvedSensitive: [...approved],
      })
        let declined: string[] = []
        if (inspection.sensitiveUnapproved.length > 0) {
          const requestId = randomUUID()
          const decision = await new Promise<'approve' | 'decline'>((resolve) => {
            backstop = { requestId, resolve }
            emit({
              type: 'approval_request',
              requestId,
              files: inspection.sensitiveUnapproved.map((file) => ({
                path: file,
                description: describeThemeFile(file) ?? 'This file is part of your theme.',
              })),
            })
          })
          if (decision === 'decline') {
            declined = inspection.sensitiveUnapproved
            inspection = {
              ...inspection,
              changed: inspection.changed.filter((file) => !declined.includes(file.path)),
              jsonProblems: inspection.jsonProblems.filter((problem) => !declined.includes(problem.file)),
              sensitiveUnapproved: [],
              warnings: [
                ...inspection.warnings,
                'You declined changes to important files, so those files were left as they were.',
              ],
            }
          } else {
            for (const file of inspection.sensitiveUnapproved) approved.add(file)
          }
        }

        const candidate = await buildCandidate({
          canonical: opts.canonical,
          workspace: opts.workspace,
          policy,
          skip: declined,
        })
      try {
        const changed = inspection.changed.map((file) => file.path)
        let blocking = inspection.jsonProblems
        let warnings = [...inspection.warnings]
        if (blocking.length === 0 && changed.length > 0) {
          const baseline = await baselineFor(base, opts.canonical)
          const current = await opts.ports.runThemeCheck(candidate.dir)
          const compared = compareThemeCheck(baseline, current, changed)
          blocking = compared.blocking
          warnings = [...warnings, ...compared.warnings.map((offense) => offense.message)]
        }
        if (blocking.length > 0) {
          const problems = blocking.filter((offense) => isRepairable(offense)).slice(0, 30)
          const repair = problems.length > 0 ? opts.session.requestRepair(problems.map(toProblem)) : { ok: false }
          if (repair.ok) {
            progress('repairing')
            return
          }
          await restore(lastGood)
          validated = lastGood !== base
          emit({ type: 'validation_blocked', message: CHANGE_MESSAGES.blocked })
          return
        }
        if (changed.length > 0) {
          const commit = await opts.history.commitTurn(opts.gitDir, opts.sessionId, candidate.dir, candidate.files, title)
          lastGood = commit
          await restore(commit)
        } else if (declined.length > 0) {
          await restore(lastGood)
        }
        validated = true
        let previewWarning: string | null = null
        let previewId: number | void = undefined
        if (changed.length > 0) {
          progress('updating_preview')
          try {
            previewId = await opts.ports.pushPreview('files', changed, opts.canonical)
          } catch (err) {
            previewWarning = err instanceof HostError ? err.userMessage : CHANGE_MESSAGES.previewSkipped
          }
        }
        const pages = pagesToCapture(opts.storeDomain, typeof previewId === 'number' ? previewId : opts.themeId, event.pageTypes)
        if (opts.ports.capture && pages.length > 0) {
          await opts.ports.capture(pages, 'after').catch(() => {})
        }
        emit({
          type: 'step_ready',
          summary: event.summary,
          warnings: [...warnings, ...(previewWarning ? [previewWarning] : [])].map((warning) => warning.slice(0, 500)).slice(0, 20),
          files: inspection.changed,
          sensitiveApproved: [...approved].filter((file) => changed.includes(file)),
        })
        if (pages.length > 0) {
          emit({
            type: 'preview_ready',
            pages: pages.map((page) => page.pageType),
            ...(typeof previewId === 'number' ? { previewThemeId: previewId } : {}),
          })
        }
      } finally {
        await rm(candidate.dir, { recursive: true, force: true })
      }
    } catch (err) {
      await restore(lastGood).catch(() => {})
      const message = err instanceof HostError ? err.userMessage : CHANGE_MESSAGES.checkFailed
      emit({ type: 'validation_blocked', message })
    }
  }

  async function preparePreview(): Promise<void> {
    progress('preparing_preview')
    try {
      const previewId = await opts.ports.pushPreview('mirror', [], opts.canonical)
      const pages = pagesToCapture(opts.storeDomain, typeof previewId === 'number' ? previewId : opts.themeId, ['index'])
      if (opts.ports.capture) await opts.ports.capture(pages, 'before')
      emit({
        type: 'preview_ready',
        pages: pages.map((page) => page.pageType),
        ...(typeof previewId === 'number' ? { previewThemeId: previewId } : {}),
      })
    } catch {
      // The preview theme is updated when the store is connected. The local change still stands.
    }
  }

  async function save(): Promise<SessionCommandResult> {
    if (!validated) return { ok: false, message: CHANGE_MESSAGES.blocked, status: 'blocked' }
    try {
      if (!confirming) {
        opts.records.openJob(themeKey, opts.sessionId)
        const sync = await opts.ports.syncTheme()
        if (sync.created) {
          const remote = new Set(sync.changes.map((change) => change.path))
          const local = await opts.history.diff(opts.gitDir, base, lastGood)
          const overlap = local.filter((change) => change.status !== 'deleted' && remote.has(change.path))
          if (overlap.length > 0) {
            const merged = await opts.history.mergeShopify(opts.gitDir, opts.sessionId)
            if (merged === 'conflict') {
              opts.records.clearJob(themeKey)
              return { ok: false, message: CHANGE_MESSAGES.driftConflict, status: 'conflict' }
            }
            const tip = await opts.history.tip(opts.gitDir, `refs/heads/session/${opts.sessionId}`)
            if (!tip) throw new Error('missing session')
            lastGood = tip
            await restore(tip)
            base = sync.commit
            const baseline = await baselineFor(sync.commit, opts.canonical)
            const current = await opts.ports.runThemeCheck(opts.canonical)
            const compared = compareThemeCheck(baseline, current, overlap.map((change) => change.path))
            if (compared.blocking.length > 0) {
              opts.records.clearJob(themeKey)
              return { ok: false, message: CHANGE_MESSAGES.checkFailed, status: 'blocked' }
            }
            await opts.ports.pushPreview('mirror', [], opts.canonical).catch(() => {})
            confirming = true
            emit({ type: 'drift_confirm', message: CHANGE_MESSAGES.driftConfirm })
            return { ok: true, message: CHANGE_MESSAGES.driftConfirm, status: 'confirm' }
          }
        }
      }
      const local = await opts.history.diff(opts.gitDir, base, lastGood)
      const files = local.filter((change) => change.status !== 'deleted').map((change) => change.path)
      if (files.length === 0) {
        opts.records.clearJob(themeKey)
        return { ok: false, message: CHANGE_MESSAGES.nothingToSave }
      }
      const theme = await opts.ports.pushSave(files, opts.canonical)
      const saved = await opts.history.commitChange(opts.gitDir, opts.sessionId, base, title)
      const sensitive = [...approved].filter((file) => saved.files.includes(file))
      const changeId = randomUUID()
      const savedTitle = shortTitle(title)
      opts.records.saveChange({
        changeId,
        storeId: opts.storeId,
        themeId: opts.themeId,
        commitId: saved.commit,
        title: savedTitle,
        sensitiveFiles: sensitive,
      })
      await opts.history.materialize(opts.gitDir, saved.commit, opts.canonical)
      opts.records.clearJob(themeKey)
      confirming = false
      validated = false
      emit({ type: 'saved', themeName: theme.name, changeId, title: savedTitle })
      return { ok: true, message: `Saved to ${theme.name}.`, status: 'saved', sessionId: opts.sessionId }
    } catch (err) {
      opts.records.clearJob(themeKey)
      const message = err instanceof HostError ? err.userMessage : CHANGE_MESSAGES.checkFailed
      return { ok: false, message }
    }
  }

  return {
    afterStep,
    preparePreview,
    save,
    noteUserMessage(text: string) {
      if (title === 'theme change') title = text
      confirming = false
    },
    decideApproval(requestId: string, decision: 'approve' | 'decline'): SessionCommandResult | null {
      if (!backstop || backstop.requestId !== requestId) return null
      const pending = backstop
      backstop = null
      pending.resolve(decision)
      return { ok: true }
    },
    async undoStep(): Promise<SessionCommandResult> {
      const rev = await opts.history.undoTurn(opts.gitDir, opts.sessionId, base)
      if (!rev) return { ok: false, message: 'There is no step to undo.' }
      lastGood = rev
      validated = rev !== base
      await restore(rev)
      await opts.ports.pushPreview('mirror', [], opts.canonical).catch(() => {})
      return { ok: true, message: CHANGE_MESSAGES.restored }
    },
    async discard(): Promise<void> {
      const shopify = await opts.history.tip(opts.gitDir, SHOPIFY_REF)
      if (shopify) await opts.history.materialize(opts.gitDir, shopify, opts.canonical)
      await opts.history.deleteBranch(opts.gitDir, opts.sessionId)
      opts.records.clearJob(themeKey)
      emit({ type: 'discarded' })
    },
    async redoOnLatest(): Promise<SessionCommandResult> {
      const sync = await opts.ports.syncTheme()
      await opts.history.deleteBranch(opts.gitDir, opts.sessionId)
      const branch = await opts.history.ensureBranch(opts.gitDir, opts.sessionId)
      base = sync.commit || branch.commit
      lastGood = base
      validated = false
      confirming = false
      await restore(base)
      return { ok: true, message: 'The latest theme files are ready. Describe the change again.' }
    },
    async recover(): Promise<void> {
      if (!opts.records.getJob(themeKey)) return
      try {
        await opts.ports.syncTheme()
        const shopify = await opts.history.tip(opts.gitDir, SHOPIFY_REF)
        if (shopify) await opts.history.materialize(opts.gitDir, shopify, opts.canonical)
      } finally {
        opts.records.clearJob(themeKey)
      }
    },
  }
}

function toProblem(offense: Offense): { file: string; check: string; message: string } {
  return { file: offense.file, check: offense.check.slice(0, 120), message: offense.message.slice(0, 500) }
}

function isRepairable(offense: Offense): boolean {
  return offense.file.length > 0 && (offense.severity === 'error' || isParseOffense(offense))
}
