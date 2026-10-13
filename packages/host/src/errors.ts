// Errors carry a stable code for the host, a plain-language message for the user (README 22),
// and an optional redacted detail for logs. Never put credentials in any of them.
export type HostErrorCode =
  | 'invalid-input'
  | 'docker-unavailable'
  | 'handoff-failed'
  | 'container-refused'
  | 'cli-failed'
  | 'timeout'
  | 'invalid-output'
  | 'theme-not-found'
  | 'empty-pull'
  | 'history-failed'
  | 'busy'

export class HostError extends Error {
  readonly code: HostErrorCode
  readonly userMessage: string
  readonly detail: string | undefined

  constructor(code: HostErrorCode, userMessage: string, detail?: string) {
    super(`${code}: ${userMessage}`)
    this.name = 'HostError'
    this.code = code
    this.userMessage = userMessage
    this.detail = detail
  }
}
