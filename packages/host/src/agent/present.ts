// Turns untrusted runner messages into what the app may show (README 6.2, 10.4, 10.7).
import { describeThemeFile, themeFileAccess } from './descriptions.ts'
import { KNOWN_PAGE_TYPES, PROGRESS_LABELS, type RunnerMessage } from './protocol.ts'
import { redact } from '../redact.ts'

const KNOWN = new Set<string>(KNOWN_PAGE_TYPES)

export function reviewApprovalRequest(files: { path: string; description: string }[]):
  | { action: 'decline' }
  | { action: 'ask'; files: { path: string; description: string }[] } {
  const presented: { path: string; description: string }[] = []
  for (const file of files) {
    const access = themeFileAccess(file.path)
    if (access === 'blocked' || access === 'outside') return { action: 'decline' }
    presented.push({
      path: file.path,
      description: describeThemeFile(file.path) ?? 'This file is part of your theme.',
    })
  }
  return { action: 'ask', files: presented }
}

export function presentProgress(stage: keyof typeof PROGRESS_LABELS): { stage: keyof typeof PROGRESS_LABELS; label: string } {
  return { stage, label: PROGRESS_LABELS[stage] }
}

export function presentText(text: string): string | null {
  const clean = redact(text).trim()
  return clean.length > 0 ? clean : null
}

export function presentStep(
  message: Extract<RunnerMessage, { type: 'step_result' }>,
  approved: readonly string[],
): {
  summary: string
  warnings: string[]
  pageTypes: (typeof KNOWN_PAGE_TYPES)[number][]
  sensitiveApproved: string[]
} {
  const summary = presentText(message.summary) ?? 'I finished this step.'
  const warnings = message.warnings.map((warning) => redact(warning).trim()).filter((warning) => warning.length > 0)
  const pageTypes = message.pageTypes.filter((page): page is (typeof KNOWN_PAGE_TYPES)[number] => KNOWN.has(page))
  return { summary, warnings, pageTypes, sensitiveApproved: [...approved] }
}
