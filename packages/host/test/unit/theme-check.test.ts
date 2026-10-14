import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareThemeCheck, parseThemeCheckOutput, THEME_CHECK_ARGS, THEME_CHECK_CONFIG } from '../../src/validation/theme-check.ts'

const report = (path: string, offenses: { check: string; severity: string; message: string }[]) => ({ path, offenses })

test('theme check arguments use the application config and do not take a credential', () => {
  assert.equal(THEME_CHECK_CONFIG, 'theme-check:recommended')
  assert.deepEqual(THEME_CHECK_ARGS, [
    'theme',
    'check',
    '--path',
    '/theme',
    '--config',
    'theme-check:recommended',
    '--output',
    'json',
    '--fail-level',
    'crash',
    '--no-color',
    '--no-input',
  ])
  assert.equal(THEME_CHECK_ARGS.includes('--password'), false)
})

test('parses file reports and normalizes paths and severities', () => {
  const offenses = parseThemeCheckOutput(
    `Checking theme\n${JSON.stringify([
      report('./sections/hero.liquid', [{ check: 'SyntaxError', severity: 'crash', message: 'Liquid did not parse.' }]),
      report('/theme/snippets/card.liquid', [{ check: 'UnusedAssign', severity: 'suggestion', message: 'unused  assign' }]),
      report('/theme/../secrets.liquid', [{ check: 'SyntaxError', severity: 'error', message: 'nope' }]),
    ])}`,
  )
  assert.deepEqual(offenses, [
    { check: 'SyntaxError', file: 'sections/hero.liquid', message: 'Liquid did not parse.', severity: 'error' },
    { check: 'UnusedAssign', file: 'snippets/card.liquid', message: 'unused assign', severity: 'warning' },
  ])
})

test('a new error blocks, a baseline error does not, and a parse error in a changed file still blocks', () => {
  const baseline = [
    { check: 'SyntaxError', file: 'sections/old.liquid', message: 'already there', severity: 'error' as const },
    { check: 'SyntaxError', file: 'sections/hero.liquid', message: 'already there', severity: 'error' as const },
    { check: 'UnusedAssign', file: 'snippets/card.liquid', message: 'known', severity: 'warning' as const },
  ]
  const current = [
    ...baseline,
    { check: 'ImgWidthAndHeight', file: 'sections/hero.liquid', message: 'missing size', severity: 'error' as const },
    { check: 'UnusedAssign', file: 'sections/hero.liquid', message: 'new warning', severity: 'warning' as const },
  ]
  const compared = compareThemeCheck(baseline, current, ['sections/hero.liquid'])
  assert.deepEqual(
    compared.blocking.map((offense) => offense.check),
    ['SyntaxError', 'ImgWidthAndHeight'],
  )
  assert.deepEqual(
    compared.warnings.map((offense) => offense.message),
    ['new warning'],
  )
  const unchanged = compareThemeCheck(baseline, baseline, ['snippets/card.liquid'])
  assert.deepEqual(unchanged.blocking, [])
  assert.deepEqual(unchanged.warnings, [])
})
