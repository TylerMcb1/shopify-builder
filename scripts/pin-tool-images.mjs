// Records local image IDs into the app tool manifest (README 21.2).
// Run after `npm run images:build`. Ids stay null until the images exist.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const manifestPath = new URL('../apps/desktop/resources/tool-manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

for (const [name, pin] of Object.entries(manifest.images)) {
  // Release pins (repo@sha256:…) come from release-tool-images.mjs and stay as they are.
  if (pin.ref.includes('@sha256:')) continue
  const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', pin.ref], { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(`Missing image ${pin.ref} (${name}). Build it with npm run images:build.\n`)
    process.exit(1)
  }
  const id = result.stdout.trim()
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) {
    process.stderr.write(`Unexpected id for ${pin.ref}: ${id}\n`)
    process.exit(1)
  }
  pin.id = id
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Pinned ${Object.keys(manifest.images).length} images in ${manifestPath.pathname}\n`)
