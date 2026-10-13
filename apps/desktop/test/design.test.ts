import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { palette } from '../src/shared/design/tokens.ts'

const renderer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer')

test('the theme stylesheet carries the README palette', () => {
  const css = readFileSync(path.join(renderer, 'styles/index.css'), 'utf8').toLowerCase()
  for (const hex of Object.values(palette)) assert.ok(css.includes(hex.toLowerCase()), hex)
})

test('screens do not hardcode colors or offer a publish control', () => {
  const source = readTree(renderer)
  assert.equal(/#[0-9a-fA-F]{3,8}/.test(source), false)
  assert.equal(/make live|replace live|\bpublish\b/i.test(source), false)
})

function readTree(dir: string): string {
  const parts: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) parts.push(readTree(full))
    else if (/\.(tsx|html)$/.test(name.name)) parts.push(readFileSync(full, 'utf8'))
  }
  return parts.join('\n')
}
