// Builds the tool images for Windows PCs (linux/amd64), pushes them to a registry, and pins
// each one by digest in the app tool manifest so a fresh install can pull them (README 21.2).
//
//   docker login ghcr.io
//   npm run images:release -- ghcr.io/<owner> 0.1.0
//
// The registry packages must be public: the app pulls them without signing in.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const [prefix, tag] = process.argv.slice(2)
if (!prefix || !tag) {
  process.stderr.write('Usage: node scripts/release-tool-images.mjs <registry/owner> <tag>\n')
  process.exit(1)
}

const root = new URL('..', import.meta.url).pathname
const manifestPath = new URL('../apps/desktop/resources/tool-manifest.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// Manifest name -> build context under containers/. Base goes first; the others build on it.
const images = [
  ['base', 'base'],
  ['agent', 'agent'],
  ['shopify', 'shopify'],
  ['gateway', 'anthropic-gateway'],
]

function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(`docker ${args.join(' ')} failed\n`)
    process.exit(1)
  }
  return result.stdout
}

const baseRef = `${prefix}/shopify-builder-base:${tag}`

for (const [name, context] of images) {
  const repo = `${prefix}/shopify-builder-${context}`
  const ref = `${repo}:${tag}`
  process.stdout.write(`Building ${ref}\n`)
  const args = ['build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false', '-t', ref]
  if (name !== 'base') args.push('--build-arg', `BASE_IMAGE=${baseRef}`)
  docker([...args, `containers/${context}`])
  docker(['push', ref])
  const digests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', ref]))
  const pinned = digests.find((entry) => entry.startsWith(`${repo}@sha256:`))
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(pinned ?? '')) {
    process.stderr.write(`No registry digest for ${ref}\n`)
    process.exit(1)
  }
  manifest.images[name] = { ref: pinned, id: null }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Pinned ${images.length} release images in ${manifestPath.pathname}\n`)
