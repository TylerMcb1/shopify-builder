// One check that the key is accepted, without spending model tokens (README 7.1).
import { CREDENTIAL_MESSAGES } from './messages.ts'

const KEY = /^sk-ant-[A-Za-z0-9_-]{10,200}$/

export function looksLikeAnthropicKey(value: string): boolean {
  return KEY.test(value)
}

export async function verifyAnthropicKey(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!looksLikeAnthropicKey(key)) return { ok: false, message: CREDENTIAL_MESSAGES.badKey }
  let response: Response
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    })
  } catch {
    return { ok: false, message: CREDENTIAL_MESSAGES.offline }
  }
  if (response.ok) return { ok: true }
  if (response.status === 401 || response.status === 403) return { ok: false, message: CREDENTIAL_MESSAGES.badKey }
  return { ok: false, message: CREDENTIAL_MESSAGES.offline }
}
