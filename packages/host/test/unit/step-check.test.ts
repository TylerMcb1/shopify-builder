import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadPathPolicy } from '../../src/intake/policy.ts'
import { buildCandidate, inspectStep } from '../../src/validation/step.ts'
import { tempDir } from '../helpers.ts'

const policy = loadPathPolicy()

async function trees() {
  const { dir, cleanup } = tempDir('sb-step-')
  const canonical = path.join(dir, 'canonical')
  const workspace = path.join(dir, 'workspace')
  await writeTheme(canonical, {
    'sections/hero.liquid': 'hello\n',
    'config/settings_data.json': '{"current":"Default"}\n',
    'layout/theme.liquid': '<html></html>\n',
  })
  await writeTheme(workspace, {
    'sections/hero.liquid': 'hello\n',
    'config/settings_data.json': '{"current":"Default"}\n',
    'layout/theme.liquid': '<html></html>\n',
  })
  return { dir, canonical, workspace, cleanup }
}

async function writeTheme(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), content)
  }
}

test('a step reports edits, restores deletions, and rejects files outside the theme', async () => {
  const box = await trees()
  try {
    await writeFile(path.join(box.workspace, 'sections/hero.liquid'), 'hello there\n')
    await writeFile(path.join(box.workspace, 'layout/checkout.liquid'), '<checkout/>')
    const { rm } = await import('node:fs/promises')
    await rm(path.join(box.workspace, 'layout/theme.liquid'))
    const inspection = await inspectStep({
      workspace: box.workspace,
      canonical: box.canonical,
      policy,
      approvedSensitive: [],
    })
    assert.deepEqual(inspection.changed, [{ path: 'sections/hero.liquid', status: 'modified' }])
    assert.deepEqual(inspection.restored, ['layout/theme.liquid'])
    assert.match(inspection.warnings.join('\n'), /restored layout\/theme.liquid/)
    assert.equal(await readFile(path.join(box.workspace, 'layout/theme.liquid'), 'utf8'), '<html></html>\n')
    assert.equal(
      await readFile(path.join(box.workspace, 'layout/checkout.liquid'), 'utf8').then(
        () => 'present',
        () => 'gone',
      ),
      'gone',
    )
  } finally {
    box.cleanup()
  }
})

test('invalid JSON is a blocking offense and a declined sensitive file keeps the canonical bytes', async () => {
  const box = await trees()
  try {
    await writeFile(path.join(box.workspace, 'config/settings_data.json'), '{')
    const inspection = await inspectStep({
      workspace: box.workspace,
      canonical: box.canonical,
      policy,
      approvedSensitive: [],
    })
    assert.deepEqual(inspection.sensitiveUnapproved, ['config/settings_data.json'])
    assert.equal(inspection.jsonProblems[0]?.check, 'JsonParse')
    assert.equal(inspection.jsonProblems[0]?.message, 'This file is not valid JSON.')
    const candidate = await buildCandidate({
      canonical: box.canonical,
      workspace: box.workspace,
      policy,
      skip: ['config/settings_data.json'],
    })
    try {
      assert.equal(await readFile(path.join(candidate.dir, 'config/settings_data.json'), 'utf8'), '{"current":"Default"}\n')
      assert.ok(candidate.files.includes('sections/hero.liquid'))
    } finally {
      const { rm } = await import('node:fs/promises')
      await rm(candidate.dir, { recursive: true, force: true })
    }
  } finally {
    box.cleanup()
  }
})

test("Shopify's auto-generated comment header is valid, and a name with spaces is kept in the candidate", async () => {
  const box = await trees()
  try {
    const header = '/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n'
    await writeTheme(box.canonical, { 'templates/page.Forms - Purchase Reviews.json': `${header}{"sections":{}}\n` })
    await writeTheme(box.workspace, {
      'templates/page.Forms - Purchase Reviews.json': `${header}{"sections":{}}\n`,
      'templates/index.json': `${header}{"sections":{"a":{"type":"text"}},"order":["a"]}\n`,
    })
    const inspection = await inspectStep({ workspace: box.workspace, canonical: box.canonical, policy, approvedSensitive: ['templates/index.json'] })
    assert.deepEqual(inspection.jsonProblems, [])
    await writeFile(path.join(box.workspace, 'templates/index.json'), `${header}{"sections": oops}\n`)
    const broken = await inspectStep({ workspace: box.workspace, canonical: box.canonical, policy, approvedSensitive: ['templates/index.json'] })
    assert.deepEqual(broken.jsonProblems.map((problem) => problem.file), ['templates/index.json'])
    const candidate = await buildCandidate({ canonical: box.canonical, workspace: box.workspace, policy, skip: [] })
    assert.ok(candidate.files.includes('templates/page.Forms - Purchase Reviews.json'))
    for (const file of candidate.files) await readFile(path.join(candidate.dir, ...file.split('/')))
  } finally {
    box.cleanup()
  }
})
