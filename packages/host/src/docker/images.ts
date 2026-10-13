// Pinned tool images (README 4, 21.2, 25). `id` is the image ID (`sha256:…`) recorded after a build.
// A release manifest ships inside the signed app. This module checks local images against it.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { dockerExec, type DockerExecResult } from './exec.ts'

export const TOOL_IMAGE_NAMES = ['base', 'agent', 'shopify', 'gateway'] as const
export type ToolImageName = (typeof TOOL_IMAGE_NAMES)[number]

const ImageId = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const ImageRef = z.string().regex(/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/)

export const ToolManifestSchema = z
  .object({
    minimumDockerVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    images: z.object({
      base: z.object({ ref: ImageRef, id: ImageId.nullable() }),
      agent: z.object({ ref: ImageRef, id: ImageId.nullable() }),
      shopify: z.object({ ref: ImageRef, id: ImageId.nullable() }),
      gateway: z.object({ ref: ImageRef, id: ImageId.nullable() }),
    }),
  })
  .strict()

export type ToolManifest = z.infer<typeof ToolManifestSchema>

export type ImagePinStatus = 'match' | 'missing' | 'mismatch' | 'unpinned'

export interface ImagePinResult {
  name: ToolImageName
  ref: string
  status: ImagePinStatus
  message: string
}

export interface ToolImageReport {
  /** True only when every image is present and its ID matches a pin. */
  ready: boolean
  status: 'ready' | 'missing' | 'mismatch' | 'unpinned' | 'invalid-manifest'
  message: string
  images: ImagePinResult[]
}

export function parseToolManifest(value: unknown): ToolManifest {
  return ToolManifestSchema.parse(value)
}

export async function readToolManifest(filePath: string): Promise<ToolManifest> {
  const raw = await readFile(filePath, 'utf8')
  return parseToolManifest(JSON.parse(raw) as unknown)
}

export function interpretImageInspect(
  manifest: ToolManifest,
  ids: Record<ToolImageName, string | null>,
): ToolImageReport {
  const images: ImagePinResult[] = TOOL_IMAGE_NAMES.map((name) => {
    const pin = manifest.images[name]
    const actual = ids[name]
    if (!actual) return { name, ref: pin.ref, status: 'missing', message: 'Not downloaded yet' }
    if (!pin.id) return { name, ref: pin.ref, status: 'unpinned', message: 'Downloaded, not locked to a release yet' }
    if (actual !== pin.id)
      return { name, ref: pin.ref, status: 'mismatch', message: "Doesn't match this version of the app" }
    return { name, ref: pin.ref, status: 'match', message: 'Ready' }
  })
  return summarize(images)
}

export async function checkToolImages(opts: {
  manifest: ToolManifest
  dockerCommand?: string
  env?: NodeJS.ProcessEnv
  run?: (args: readonly string[]) => Promise<DockerExecResult>
}): Promise<ToolImageReport> {
  const run =
    opts.run ?? ((args) => dockerExec(opts.dockerCommand ?? 'docker', args, { env: opts.env, timeoutMs: 15_000 }))
  const ids = {} as Record<ToolImageName, string | null>
  for (const name of TOOL_IMAGE_NAMES) {
    const ref = opts.manifest.images[name].ref
    const report = await run(['image', 'inspect', '--format', '{{.Id}}', ref])
    const id = report.exitCode === 0 ? report.stdout.trim() : ''
    ids[name] = /^sha256:[a-f0-9]{64}$/.test(id) ? id : null
  }
  return interpretImageInspect(opts.manifest, ids)
}

function summarize(images: ImagePinResult[]): ToolImageReport {
  const has = (status: ImagePinStatus) => images.some((image) => image.status === status)
  if (has('missing')) {
    return {
      ready: false,
      status: 'missing',
      message: 'Some tools are still missing. They download once Docker Desktop is running.',
      images,
    }
  }
  if (has('mismatch')) {
    return {
      ready: false,
      status: 'mismatch',
      message: "A tool doesn't match this version of Shopify Builder.",
      images,
    }
  }
  if (has('unpinned')) {
    return {
      ready: false,
      status: 'unpinned',
      message: 'Tools are downloaded. A release checks the exact version.',
      images,
    }
  }
  return { ready: true, status: 'ready', message: 'Ready', images }
}
