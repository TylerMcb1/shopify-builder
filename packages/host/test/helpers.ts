import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const FAKE_DOCKER = path.join(FIXTURES, 'fake-docker.mjs')
export const TEST_IMAGE = 'shopify-builder/shopify:test'
export const TEST_TOKEN = 'shptka_' + 'a1b2c3d4'.repeat(4)

chmodSync(FAKE_DOCKER, 0o755)
chmodSync(path.join(FIXTURES, 'bin', 'shopify'), 0o755)

export function tempDir(prefix = 'sb-host-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
