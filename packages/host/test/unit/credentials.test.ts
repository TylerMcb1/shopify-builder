import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CREDENTIAL_MESSAGES } from '../../src/credentials/messages.ts'
import { openSecretStore, type SecretCodec } from '../../src/credentials/secrets.ts'
import { looksLikeAnthropicKey, verifyAnthropicKey } from '../../src/credentials/verify.ts'

const codec: SecretCodec = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`v1:${plain}`),
  decrypt: (ciphertext) => {
    const text = ciphertext.toString('utf8')
    if (!text.startsWith('v1:')) throw new Error('locked')
    return text.slice(3)
  },
}

test('a saved key is ciphertext on disk and round-trips only through the codec', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-secrets-'))
  const store = openSecretStore(dir, codec)
  const key = 'sk-ant-api03-examplekeyvalue'
  store.save('anthropic', key)
  const raw = readFileSync(path.join(dir, 'secrets.json'), 'utf8')
  assert.equal(raw.includes(key), false)
  assert.equal(store.load('anthropic'), key)
  store.remove('anthropic')
  assert.equal(store.load('anthropic'), null)
  assert.equal(store.has('shopify'), false)
})

test('a key that cannot be decrypted is locked instead of returned', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-secrets-'))
  const store = openSecretStore(dir, codec)
  store.save('anthropic', 'sk-ant-api03-examplekeyvalue')
  const locked = openSecretStore(dir, { ...codec, decrypt: () => { throw new Error('profile changed') } })
  assert.equal(locked.locked('anthropic'), true)
  assert.equal(locked.load('anthropic'), null)
})

test('key verification accepts only a working key and never describes the key', async () => {
  assert.equal(looksLikeAnthropicKey('sk-ant-api03-examplekey'), true)
  assert.equal(looksLikeAnthropicKey('not-a-key'), false)
  const offline = await verifyAnthropicKey('sk-ant-api03-examplekey', async () => {
    throw new Error('network down')
  })
  assert.deepEqual(offline, { ok: false, message: CREDENTIAL_MESSAGES.offline })
  const rejected = await verifyAnthropicKey('sk-ant-api03-examplekey', async () => new Response('', { status: 401 }))
  assert.deepEqual(rejected, { ok: false, message: CREDENTIAL_MESSAGES.badKey })
  const accepted = await verifyAnthropicKey('sk-ant-api03-examplekey', async (_url, init) => {
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('x-api-key'), 'sk-ant-api03-examplekey')
    assert.equal(headers.get('anthropic-version'), '2023-06-01')
    return new Response('{"data":[]}', { status: 200 })
  })
  assert.deepEqual(accepted, { ok: true })
  const bad = await verifyAnthropicKey('nope')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.message, CREDENTIAL_MESSAGES.badKey)
})
