import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseThemeList, STORE_DOMAIN } from '../../src/shopify/schemas.ts'

test('parses the CLI theme list and strips unknown fields', () => {
  const themes = parseThemeList('[{"id":1,"name":"Dawn","role":"live","extra":"x"},{"id":2,"name":"Copy","role":"unpublished"}]\n')
  assert.deepEqual(themes, [
    { id: 1, name: 'Dawn', role: 'live' },
    { id: 2, name: 'Copy', role: 'unpublished' },
  ])
})

test('rejects malformed, duplicated or unsafe theme ids', () => {
  for (const bad of ['', 'nope', '{}', '[{"id":"1","name":"a","role":"live"}]', '[{"id":-1,"name":"a","role":"live"}]', '[{"id":1.5,"name":"a","role":"live"}]', '[{"id":1,"name":"a","role":"live"},{"id":1,"name":"b","role":"unpublished"}]', '[{"id":9007199254740993,"name":"a","role":"live"}]']) {
    assert.throws(() => parseThemeList(bad), bad)
  }
})

test('store domain must be a myshopify.com domain', () => {
  assert.ok(STORE_DOMAIN.test('my-store.myshopify.com'))
  for (const bad of ['evil.com', 'my-store.myshopify.com.evil.com', 'a.b.myshopify.com', '--store.myshopify.com', 'My-Store.myshopify.com']) assert.ok(!STORE_DOMAIN.test(bad), bad)
})
