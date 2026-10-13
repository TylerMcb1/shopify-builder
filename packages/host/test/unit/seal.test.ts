import { test } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'libsodium-wrappers'
import { isHandoffPublicKey, sealSecret } from '../../src/credentials/seal.ts'

test('sealed secret opens only with the one-time private key', async () => {
  await sodium.ready
  const v = sodium.base64_variants.ORIGINAL
  const { publicKey, privateKey } = sodium.crypto_box_keypair()
  const sealed = await sealSecret(sodium.to_base64(publicKey, v), 'shptka_secret')
  assert.ok(!sealed.includes('shptka'))
  const plain = sodium.crypto_box_seal_open(sodium.from_base64(sealed, v), publicKey, privateKey)
  assert.equal(sodium.to_string(plain), 'shptka_secret')

  const other = sodium.crypto_box_keypair()
  assert.throws(() => sodium.crypto_box_seal_open(sodium.from_base64(sealed, v), other.publicKey, other.privateKey))
})

test('rejects malformed public keys and empty secrets', async () => {
  assert.equal(isHandoffPublicKey('not a key'), false)
  assert.equal(isHandoffPublicKey('{"source":"x"}'), false)
  await assert.rejects(sealSecret('AAAA', 'x'))
  await sodium.ready
  const pub = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.ORIGINAL)
  await assert.rejects(sealSecret(pub, ''))
})
