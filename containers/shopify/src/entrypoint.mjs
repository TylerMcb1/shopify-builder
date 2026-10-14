// Secret-receiving entrypoint (README 6.3, 6.5). Runs exactly one Shopify CLI command.
import { spawn } from 'node:child_process'
import { receiveSecret } from './handoff.mjs'
import { checkArgs } from './policy.mjs'

const fail = (message) => {
  process.stderr.write(JSON.stringify({ source: 'shopify-entrypoint', error: message }) + '\n')
  process.exit(2)
}

const args = process.argv.slice(2)
const refusal = checkArgs(args)
if (refusal) fail(refusal)

// Theme Check is the only command that runs without a credential (README 11, 14.3).
// Every other command fails closed until the sealed handoff succeeds.
const mode = process.env.SHOPIFY_HANDOFF ?? 'required'
if (mode !== 'required' && mode !== 'none') fail('invalid SHOPIFY_HANDOFF')
if (args[1] === 'check' && mode !== 'none') fail('theme check does not take a credential')
if (args[1] !== 'check' && mode !== 'required') fail('credential required')

const env = { ...process.env }
delete env.SHOPIFY_HANDOFF
delete env.SHOPIFY_CLI_THEME_TOKEN
if (mode === 'required') {
  try {
    env.SHOPIFY_CLI_THEME_TOKEN = await receiveSecret(process.stdin, process.stdout)
  } catch (err) {
    fail(err.message)
  }
}

// stdin is closed (ignored) for the CLI so any confirmation prompt fails instead of proceeding.
const child = spawn('shopify', args, { env, stdio: ['ignore', 'inherit', 'inherit'] })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
child.on('error', (err) => fail(`failed to start shopify: ${err.code ?? 'error'}`))
