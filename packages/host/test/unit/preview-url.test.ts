import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagesToCapture } from '../../src/preview/url.ts'

test('builds preview urls for stable pages and drops pages that need a handle', () => {
  const pages = pagesToCapture('example.myshopify.com', 42, ['product', 'collection', 'customers/account', 'gift_card', 'index'])
  assert.deepEqual(
    pages.map((page) => page.pageType),
    ['index', 'collection', 'customers/account'],
  )
  assert.equal(pages[0]?.url, 'https://example.myshopify.com/?preview_theme_id=42')
  assert.equal(pages[1]?.url, 'https://example.myshopify.com/collections/all?preview_theme_id=42')
  assert.equal(pages[2]?.url, 'https://example.myshopify.com/account?preview_theme_id=42')
})

test('keeps at most six pages and refuses a bad store or theme id', () => {
  const pages = pagesToCapture('example.myshopify.com', 7, [
    'collection',
    'list-collections',
    'cart',
    'search',
    '404',
    'password',
    'customers/login',
  ])
  assert.equal(pages.length, 6)
  assert.equal(pages[0]?.pageType, 'index')
  assert.equal(pages.at(-1)?.pageType, '404')
  assert.equal(pages.some((page) => page.pageType === 'password'), false)
  assert.deepEqual(pagesToCapture('example.com', 7, ['index']), [])
  assert.deepEqual(pagesToCapture('example.myshopify.com', 0, ['index']), [])
})
