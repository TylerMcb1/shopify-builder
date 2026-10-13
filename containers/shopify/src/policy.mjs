// Defense in depth only: the host's write gateway is the authoritative policy (README 9.2).
// Anything not listed here fails closed.
const ALLOWED_SUBCOMMANDS = new Set(['list', 'pull', 'push', 'check'])
const FORBIDDEN_FLAGS = ['--allow-live', '-a', '--publish', '-p', '--delete', '-d']

export function checkArgs(args) {
  if (args[0] !== 'theme') return 'only "theme" commands are allowed'
  if (!ALLOWED_SUBCOMMANDS.has(args[1])) return `theme ${args[1] ?? ''} is not allowed`
  for (const arg of args.slice(2)) {
    const flag = arg.split('=')[0]
    if (FORBIDDEN_FLAGS.includes(flag)) return `${flag} is not allowed`
  }
  return null
}
