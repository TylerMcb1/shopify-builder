// Host side of the encrypted secret handoff (README 6.5): seal the secret to the container's one-time public key.
import sodium from 'libsodium-wrappers'

const PUBLIC_KEY_B64 = /^[A-Za-z0-9+/]{43}=$/

export function isHandoffPublicKey(line: string): boolean {
  return PUBLIC_KEY_B64.test(line)
}

export async function sealSecret(publicKeyB64: string, secret: string): Promise<string> {
  await sodium.ready
  if (!isHandoffPublicKey(publicKeyB64)) throw new Error('handoff: invalid public key')
  if (!secret) throw new Error('handoff: empty secret')
  const v = sodium.base64_variants.ORIGINAL
  const publicKey = sodium.from_base64(publicKeyB64, v)
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('handoff: invalid public key')
  const message = sodium.from_string(secret)
  try {
    return sodium.to_base64(sodium.crypto_box_seal(message, publicKey), v)
  } finally {
    sodium.memzero(message)
  }
}
