// Builds the `docker run` argument array for one Shopify container (README 6.3).
// Must stay in sync with the `x-hardened` block and `shopify` service in containers/compose.yaml.
import path from 'node:path'

export interface ShopifyRunSpec {
  image: string
  network: string
  containerName: string
  /** Host directory bind-mounted read-write at /inbox (pull only). */
  inboxHostPath?: string
  /** Host directory bind-mounted read-only at /theme (push and Theme Check). */
  themeHostPath?: string
  /** Theme Check sets this so the entrypoint does not ask for a credential. */
  handoff?: 'required' | 'none'
  /** Arguments passed to the container entrypoint, e.g. ['theme', 'list', '--json', ...]. */
  cliArgs: readonly string[]
}

export const INBOX_MOUNT_TARGET = '/inbox'
export const THEME_MOUNT_TARGET = '/theme'
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

export function buildShopifyRunArgs(spec: ShopifyRunSpec): string[] {
  if (!spec.image) throw new Error('image is required')
  if (!spec.network) throw new Error('network is required')
  if (!CONTAINER_NAME.test(spec.containerName)) throw new Error('invalid container name')

  const args = [
    'run',
    '--rm',
    '-i',
    '--pull',
    'never',
    '--name',
    spec.containerName,
    '--label',
    'app=shopify-builder',
    '--label',
    'role=shopify',
    '--user',
    '10001:10001',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '256',
    '--memory',
    '1g',
    '--cpus',
    '1',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--log-driver',
    'none',
    '--network',
    spec.network,
  ]

  if (spec.handoff === 'none') args.push('-e', 'SHOPIFY_HANDOFF=none')

  if (spec.inboxHostPath !== undefined && spec.themeHostPath !== undefined) {
    throw new Error('a Shopify container mounts inbox or theme, not both')
  }
  if (spec.inboxHostPath !== undefined) {
    args.push('--mount', bind(spec.inboxHostPath, INBOX_MOUNT_TARGET, false))
  }
  if (spec.themeHostPath !== undefined) {
    args.push('--mount', bind(spec.themeHostPath, THEME_MOUNT_TARGET, true))
  }

  args.push(spec.image, ...spec.cliArgs)
  return args
}

function bind(source: string, target: string, readOnly: boolean): string {
  // --mount is comma-separated key=value; reject anything that could inject extra mount options.
  if (!path.isAbsolute(source) || /[,"=\n\r]/.test(source)) throw new Error('invalid mount path')
  const mode = readOnly ? ',readonly' : ''
  return `type=bind,source=${source},target=${target}${mode}`
}
