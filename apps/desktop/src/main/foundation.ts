// Startup check for Docker Desktop and the pinned tool images (README 6.6, 8.1, 21.2).
import {
  TOOL_IMAGE_NAMES,
  type ToolImageName,
  type ToolImageReport,
} from '../../../../packages/host/src/docker/images.ts'
import type { DockerStatus } from '../../../../packages/host/src/docker/status.ts'
import { SetupStatusSchema, type SetupStatus } from '../shared/contracts/setup.ts'

export interface FoundationCheck {
  manifestOk: boolean
  checkDocker: () => Promise<DockerStatus>
  checkImages: () => Promise<ToolImageReport>
}

const INVALID = "Shopify Builder couldn't read its tool list."
const WAITING = 'Tools can be checked once Docker Desktop is ready.'

export async function collectSetupStatus(check: FoundationCheck): Promise<SetupStatus> {
  const docker = await check.checkDocker()
  if (!check.manifestOk) return parse(docker, blank('invalid-manifest', INVALID))
  if (docker.state !== 'ready') return parse(docker, blank('missing', WAITING))
  try {
    return parse(docker, await check.checkImages())
  } catch {
    return parse(docker, blank('invalid-manifest', INVALID))
  }
}

function parse(docker: DockerStatus, images: ToolImageReport): SetupStatus {
  return SetupStatusSchema.parse({ docker, images })
}

function blank(status: ToolImageReport['status'], message: string): ToolImageReport {
  return {
    ready: false,
    status,
    message,
    images: TOOL_IMAGE_NAMES.map((name) => row(name)),
  }
}

function row(name: ToolImageName): ToolImageReport['images'][number] {
  return { name, ref: '', status: 'missing', message: 'Not checked' }
}
