import { test } from 'node:test'
import assert from 'node:assert/strict'
import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HostError } from '../../src/errors.ts'
import { sessionPaths } from '../../src/store/layout.ts'
import { discardSessionDir, prepareSessionWorkspace } from '../../src/agent/workspace.ts'
import { tempDir } from '../helpers.ts'

test('a session copies the theme and skips dotfiles, symlinks, and hard links', async () => {
  const { dir, cleanup } = tempDir('sb-workspace-')
  try {
    const canonical = path.join(dir, 'canonical')
    await mkdir(path.join(canonical, 'sections'), { recursive: true })
    await writeFile(path.join(canonical, 'sections', 'hero.liquid'), 'hello\n')
    await writeFile(path.join(canonical, '.env'), 'secret\n')
    await symlink(path.join(canonical, 'sections', 'hero.liquid'), path.join(canonical, 'sections', 'link.liquid'))
    await writeFile(path.join(canonical, 'sections', 'linked.liquid'), 'linked\n')
    await link(path.join(canonical, 'sections', 'linked.liquid'), path.join(canonical, 'sections', 'also-linked.liquid'))

    const paths = sessionPaths(dir, 'shop', 'session-1')
    await prepareSessionWorkspace({ canonicalDir: canonical, paths, themeId: 7, storeId: 'shop', resume: false })
    assert.equal(await readFile(path.join(paths.workspace, 'sections', 'hero.liquid'), 'utf8'), 'hello\n')
    await assert.rejects(readFile(path.join(paths.workspace, '.env'), 'utf8'))
    await assert.rejects(readFile(path.join(paths.workspace, 'sections', 'link.liquid'), 'utf8'))
    await assert.rejects(readFile(path.join(paths.workspace, 'sections', 'linked.liquid'), 'utf8'))

    await writeFile(path.join(paths.workspace, 'sections', 'hero.liquid'), 'edited\n')
    await writeFile(path.join(canonical, 'sections', 'hero.liquid'), 'canonical changed\n')
    await prepareSessionWorkspace({ canonicalDir: canonical, paths, themeId: 7, storeId: 'shop', resume: true })
    assert.equal(await readFile(path.join(paths.workspace, 'sections', 'hero.liquid'), 'utf8'), 'edited\n')

    await assert.rejects(
      prepareSessionWorkspace({
        canonicalDir: canonical,
        paths: sessionPaths(dir, 'shop', 'session-2'),
        themeId: 7,
        storeId: 'shop',
        resume: true,
      }),
      (err: unknown) => err instanceof HostError && err.code === 'invalid-input',
    )

    const again = sessionPaths(dir, 'shop', 'session-1')
    await assert.rejects(
      prepareSessionWorkspace({ canonicalDir: canonical, paths: again, themeId: 7, storeId: 'shop', resume: false }),
      (err: unknown) => err instanceof HostError && err.code === 'busy',
    )

    await discardSessionDir(paths)
    await assert.rejects(readFile(path.join(paths.workspace, 'sections', 'hero.liquid'), 'utf8'))
    assert.throws(() => sessionPaths(dir, 'shop', '../other'))
    assert.throws(() => sessionPaths('relative', 'shop', 'session-1'))
  } finally {
    cleanup()
  }
})
