// Defense in depth only: the host's write gateway is the authoritative policy (README 9.2, 11).
// Anything not listed here fails closed.
const ALLOWED_SUBCOMMANDS = new Set(['list', 'pull', 'push', 'check'])
// --password would put the credential on a command line. --environment would read a theme-directory
// config. --live / --allow-live / --publish / --delete are never this app's commands.
const FORBIDDEN_FLAGS = [
  '--allow-live',
  '-a',
  '--publish',
  '-p',
  '--delete',
  '-d',
  '--live',
  '-l',
  '--password',
  '--environment',
  '-e',
  '--force',
  '-f',
]

const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/
const THEME_ID = /^[1-9][0-9]{0,18}$/
// App-generated names such as "[Builder] Working copy". No leading dash, so a name cannot be a flag.
const THEME_NAME = /^[A-Za-z0-9[][A-Za-z0-9 .[\]_-]{0,60}$/
const THEME_CHECK_CONFIG = 'theme-check:recommended'

const PULL_VALUE_FLAGS = new Set(['--theme', '-t', '--path', '--store', '-s'])
const PULL_BOOLEAN_FLAGS = new Set(['--no-color', '--verbose'])

const PUSH_VALUE_FLAGS = new Set(['--theme', '--path', '--store', '--only'])
const PUSH_BOOLEAN_FLAGS = new Set(['--json', '--no-color', '--no-input', '--nodelete', '--unpublished', '--development'])

const CHECK_VALUE_FLAGS = new Set(['--path', '--config', '--output', '--fail-level'])
const CHECK_BOOLEAN_FLAGS = new Set(['--no-color', '--no-input'])

export function checkArgs(args) {
  if (args[0] !== 'theme') return 'only "theme" commands are allowed'
  if (!ALLOWED_SUBCOMMANDS.has(args[1])) return `theme ${args[1] ?? ''} is not allowed`
  for (const arg of args.slice(2)) {
    const flag = arg.split('=')[0]
    if (FORBIDDEN_FLAGS.includes(flag)) return `${flag} is not allowed`
  }
  if (args[1] === 'pull') return checkPull(args.slice(2))
  if (args[1] === 'push') return checkPush(args.slice(2))
  if (args[1] === 'check') return checkThemeCheck(args.slice(2))
  return null
}

function checkPull(rest) {
  const parsed = parseFlags(rest, PULL_VALUE_FLAGS, PULL_BOOLEAN_FLAGS, 'theme pull')
  if (parsed.error) return parsed.error
  const theme = only(parsed.values, '--theme', '-t')
  const themePath = only(parsed.values, '--path')
  if (theme.error) return `theme pull: ${theme.error}`
  if (themePath.error) return `theme pull: ${themePath.error}`
  if (!THEME_ID.test(theme.value ?? '')) return 'theme pull: --theme must be a numeric theme id'
  if (themePath.value !== '/inbox') return 'theme pull: --path must be /inbox'
  return null
}

function checkPush(rest) {
  const parsed = parseFlags(rest, PUSH_VALUE_FLAGS, PUSH_BOOLEAN_FLAGS, 'theme push')
  if (parsed.error) return parsed.error
  const { values, booleans } = parsed
  if (!booleans.has('--nodelete')) return 'theme push: --nodelete is required'
  if (!booleans.has('--json')) return 'theme push: --json is required'
  const themePath = only(values, '--path')
  const store = only(values, '--store')
  const theme = only(values, '--theme')
  if (themePath.error) return `theme push: ${themePath.error}`
  if (store.error) return `theme push: ${store.error}`
  if (theme.error) return `theme push: ${theme.error}`
  if (themePath.value !== '/theme') return 'theme push: --path must be /theme'
  if (!STORE_DOMAIN.test(store.value ?? '')) return 'theme push: --store must be a myshopify.com domain'
  const unpublished = booleans.has('--unpublished')
  const development = booleans.has('--development')
  if (unpublished && development) return 'theme push: --unpublished and --development cannot be combined'
  const onlyFiles = values.get('--only') ?? []
  if (unpublished) {
    if (onlyFiles.length > 0) return 'theme push: --only is not used when creating a theme'
    if (!THEME_NAME.test(theme.value ?? '')) return 'theme push: --theme must be the new theme name'
    return null
  }
  if (development) {
    if (theme.value !== undefined) return 'theme push: --development does not take --theme'
    if (onlyFiles.length > 0) return 'theme push: --only is not used when creating the preview theme'
    return null
  }
  if (!THEME_ID.test(theme.value ?? '')) return 'theme push: --theme must be a numeric theme id'
  for (const file of onlyFiles) {
    if (!isThemeFile(file)) return `theme push: --only must be a theme file (${file})`
  }
  return null
}

function checkThemeCheck(rest) {
  const parsed = parseFlags(rest, CHECK_VALUE_FLAGS, CHECK_BOOLEAN_FLAGS, 'theme check')
  if (parsed.error) return parsed.error
  const themePath = only(parsed.values, '--path')
  const config = only(parsed.values, '--config')
  const output = only(parsed.values, '--output')
  const level = only(parsed.values, '--fail-level')
  if (themePath.error) return `theme check: ${themePath.error}`
  if (config.error) return `theme check: ${config.error}`
  if (output.error) return `theme check: ${output.error}`
  if (level.error) return `theme check: ${level.error}`
  if (themePath.value !== '/theme') return 'theme check: --path must be /theme'
  if (config.value !== THEME_CHECK_CONFIG) return 'theme check: --config must be the application configuration'
  if (output.value !== 'json') return 'theme check: --output must be json'
  if (level.value !== 'crash') return 'theme check: --fail-level must be crash'
  if (!parsed.booleans.has('--no-input')) return 'theme check: --no-input is required'
  return null
}

/** One path segment style, matching the host theme-path rule. No globs, no escapes. */
function isThemeFile(value) {
  if (value.length < 1 || value.length > 240) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('//')) return false
  if (value.includes('*') || value.includes('?')) return false
  return value.split('/').every((part) => {
    if (part.length === 0 || part === '.' || part === '..' || part.startsWith('.')) return false
    return /^[a-zA-Z0-9_-]+([ .][a-zA-Z0-9_-]+)*$/.test(part)
  })
}

function parseFlags(rest, valueFlags, booleanFlags, label) {
  const values = new Map()
  const booleans = new Set()
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = rest[i].split(/=(.*)/s, 2)
    if (booleanFlags.has(flag)) {
      if (inline !== undefined) return { error: `${label}: ${flag} does not take a value` }
      booleans.add(flag)
      continue
    }
    if (!valueFlags.has(flag)) return { error: `${label}: ${flag} is not allowed` }
    const value = inline ?? rest[++i]
    if (value === undefined || value.startsWith('-')) return { error: `${label}: ${flag} needs a value` }
    const key = flag === '-t' ? '--theme' : flag === '-s' ? '--store' : flag
    if (!values.has(key)) values.set(key, [])
    values.get(key).push(value)
  }
  return { values, booleans }
}

function only(values, key, alias) {
  const list = values.get(key) ?? (alias ? values.get(alias) : undefined) ?? []
  if (list.length > 1) return { error: `${key} given twice` }
  return { value: list[0] }
}
