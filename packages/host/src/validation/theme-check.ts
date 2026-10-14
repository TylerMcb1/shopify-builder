// Theme Check output and baseline comparison (README 14.3).
// Offenses match on check name, file, and message. Line numbers are ignored.
import { z } from 'zod'

export interface Offense {
  check: string
  file: string
  message: string
  severity: 'error' | 'warning'
}

export const THEME_CHECK_CONFIG = 'theme-check:recommended'

/** Argument array for `shopify theme check`. No credential, no network, app config only. */
export const THEME_CHECK_ARGS = [
  'theme',
  'check',
  '--path',
  '/theme',
  '--config',
  THEME_CHECK_CONFIG,
  '--output',
  'json',
  '--fail-level',
  'crash',
  '--no-color',
  '--no-input',
] as const

const OffenseSchema = z
  .object({
    check: z.string().min(1).max(120),
    severity: z.string().min(1).max(32),
    message: z.string().min(1).max(500),
  })
  .passthrough()

const FileReportSchema = z
  .object({
    path: z.string().min(1).max(300),
    offenses: z.array(OffenseSchema).max(200).default([]),
  })
  .passthrough()

export function parseThemeCheckOutput(stdout: string): Offense[] {
  const value = parseJsonDocument(stdout)
  const reports = z.array(FileReportSchema).max(5000).safeParse(Array.isArray(value) ? value : [value])
  if (!reports.success) throw new Error('theme check output is not a list of file reports')
  const offenses: Offense[] = []
  for (const report of reports.data) {
    const file = normalizeThemeFile(report.path)
    if (!file) continue
    for (const offense of report.offenses) {
      offenses.push({
        check: offense.check,
        file,
        message: offense.message.replace(/\s+/g, ' ').trim(),
        severity: offense.severity === 'error' || offense.severity === 'crash' ? 'error' : 'warning',
      })
    }
  }
  return offenses
}

export function compareThemeCheck(
  baseline: readonly Offense[],
  current: readonly Offense[],
  changedFiles: readonly string[],
): { blocking: Offense[]; warnings: Offense[] } {
  const baselineErrors = new Set(baseline.filter((offense) => offense.severity === 'error').map(offenseKey))
  const baselineAll = new Set(baseline.map(offenseKey))
  const changed = new Set(changedFiles)
  const blocking: Offense[] = []
  const warnings: Offense[] = []
  const seen = new Set<string>()
  for (const offense of current) {
    const key = offenseKey(offense)
    if (seen.has(key)) continue
    seen.add(key)
    const isNewError = offense.severity === 'error' && !baselineErrors.has(key)
    const parseInChange = offense.severity === 'error' && changed.has(offense.file) && isParseOffense(offense)
    if (isNewError || parseInChange) blocking.push(offense)
    else if (offense.severity === 'warning' && !baselineAll.has(key)) warnings.push(offense)
  }
  return { blocking, warnings }
}

export function isParseOffense(offense: Pick<Offense, 'check'>): boolean {
  return /syntax|parse/i.test(offense.check)
}

function offenseKey(offense: Offense): string {
  return `${offense.check}\0${offense.file}\0${offense.message}`
}

function normalizeThemeFile(value: string): string | null {
  let file = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (file.startsWith('/theme/')) file = file.slice('/theme/'.length)
  if (!file || file.startsWith('/') || file.split('/').some((part) => part === '..' || part.startsWith('.'))) return null
  return file
}

function parseJsonDocument(stdout: string): unknown {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('[')
    if (start === -1) throw new Error('theme check output is not JSON')
    return JSON.parse(trimmed.slice(start))
  }
}
