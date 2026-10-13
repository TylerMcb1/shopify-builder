// Defense in depth only: the host's write gateway is the authoritative policy (README 9.2).
// Anything not listed here fails closed.
const ALLOWED_SUBCOMMANDS = new Set(['list', 'pull', 'push', 'check'])
// --password would put the credential on a command line; --environment/--path for list would read
// shopify.theme.toml from a theme directory (README 11).
const FORBIDDEN_FLAGS = ['--allow-live', '-a', '--publish', '-p', '--delete', '-d', '--password', '--environment', '-e', '--force', '-f']

// `theme pull`: only by immutable theme ID, only into the mounted /inbox (README 6.3, 11).
const PULL_VALUE_FLAGS = new Set(['--theme', '-t', '--path', '--store', '-s'])
const PULL_BOOLEAN_FLAGS = new Set(['--no-color', '--verbose'])

export function checkArgs(args) {
  if (args[0] !== 'theme') return 'only "theme" commands are allowed'
  if (!ALLOWED_SUBCOMMANDS.has(args[1])) return `theme ${args[1] ?? ''} is not allowed`
  for (const arg of args.slice(2)) {
    const flag = arg.split('=')[0]
    if (FORBIDDEN_FLAGS.includes(flag)) return `${flag} is not allowed`
  }
  if (args[1] === 'pull') return checkPull(args.slice(2))
  return null
}

function checkPull(rest) {
  const values = new Map()
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = rest[i].split(/=(.*)/s, 2)
    if (PULL_BOOLEAN_FLAGS.has(flag) && inline === undefined) continue
    if (!PULL_VALUE_FLAGS.has(flag)) return `theme pull: ${flag} is not allowed`
    const value = inline ?? rest[++i]
    if (value === undefined) return `theme pull: ${flag} needs a value`
    const key = flag === '-t' ? '--theme' : flag === '-s' ? '--store' : flag
    if (values.has(key)) return `theme pull: ${key} given twice`
    values.set(key, value)
  }
  if (!/^[1-9][0-9]{0,18}$/.test(values.get('--theme') ?? '')) return 'theme pull: --theme must be a numeric theme id'
  if (values.get('--path') !== '/inbox') return 'theme pull: --path must be /inbox'
  return null
}
