// Agent runner skeleton (README 6.2). Phase 3 implements the Claude Agent SDK session,
// tool restrictions and permission checks; this file fixes the container contract:
// line-delimited JSON on stdin/stdout, nothing else.
import readline from 'node:readline'

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')

send({ type: 'ready', workspace: process.env.WORKSPACE_DIR })

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    send({ type: 'error', message: 'malformed input' })
    return
  }
  if (message?.type === 'cancel') process.exit(0)
  send({ type: 'error', message: 'not implemented' })
})
rl.on('close', () => process.exit(0))
