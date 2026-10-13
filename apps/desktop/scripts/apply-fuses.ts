// Flip Electron fuses on a packaged binary (README 20). Do not point this at the dev Electron.
import { flipFuses, FuseVersion } from '@electron/fuses'
import { fuseOptions } from '../src/shared/security/fuses.ts'

const target = process.argv[2]
if (!target) {
  process.stderr.write('Usage: node scripts/apply-fuses.ts <path-to-packaged-electron>\n')
  process.exit(1)
}

await flipFuses(target, { version: FuseVersion.V1, ...fuseOptions })
process.stdout.write(`Fuses applied to ${target}\n`)
