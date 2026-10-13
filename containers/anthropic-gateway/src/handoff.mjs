// Receiving side of the encrypted secret handoff (README 6.5).
// Writes only the one-time public key (base64) to `out`, reads one base64 sealed box
// from `input`, and returns the decrypted secret. The private key never leaves memory.
import sodium from 'libsodium-wrappers'

const MAX_CIPHERTEXT_CHARS = 8192

export async function receiveSecret(input, out) {
  await sodium.ready
  const { publicKey, privateKey } = sodium.crypto_box_keypair()
  out.write(sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL) + '\n')

  let buffer = ''
  for await (const chunk of input) {
    buffer += chunk.toString('utf8')
    if (buffer.length > MAX_CIPHERTEXT_CHARS) throw new Error('handoff: input too large')
    if (buffer.includes('\n')) break
  }
  input.destroy?.() // close stdin: only one message is ever accepted

  const line = buffer.split('\n')[0].trim()
  if (!line) throw new Error('handoff: no ciphertext received')
  try {
    const sealed = sodium.from_base64(line, sodium.base64_variants.ORIGINAL)
    const plain = sodium.crypto_box_seal_open(sealed, publicKey, privateKey)
    return sodium.to_string(plain)
  } catch {
    throw new Error('handoff: decryption failed')
  } finally {
    sodium.memzero(privateKey)
  }
}
