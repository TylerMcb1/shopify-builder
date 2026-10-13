// Anthropic-only forwarding rules. Deny by default.
export const UPSTREAM_HOST = 'api.anthropic.com'

const ALLOWED = new Map([
  ['POST /v1/messages', true],
  ['POST /v1/messages/count_tokens', true],
])

// Only these request headers are forwarded; credentials from the agent are dropped.
const FORWARDED_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent']

export function checkRequest(method, url) {
  // Origin-form paths only: reject absolute and protocol-relative (//host) request targets.
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return { ok: false, reason: 'bad-url' }
  let pathname
  try {
    pathname = new URL(url, 'http://gateway.invalid').pathname
  } catch {
    return { ok: false, reason: 'bad-url' }
  }
  if (!ALLOWED.has(`${method} ${pathname}`)) return { ok: false, reason: 'path-not-allowed', path: pathname }
  return { ok: true, path: pathname }
}

export function buildUpstreamHeaders(incoming, apiKey) {
  const headers = {}
  for (const name of FORWARDED_HEADERS) {
    if (incoming[name] !== undefined) headers[name] = incoming[name]
  }
  headers['x-api-key'] = apiKey
  headers.host = UPSTREAM_HOST
  return headers
}
