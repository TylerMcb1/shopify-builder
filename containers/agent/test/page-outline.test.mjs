import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildPageOutline } from '../src/page-outline.mjs'

const SHOPIFY_NOTICE = '/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n'

async function theme(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'sb-outline-'))
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return root
}

const schema = (name) => `<div></div>\n{% schema %}\n${JSON.stringify({ name })}\n{% endschema %}\n`

const store = {
  'layout/theme.liquid':
    '<body>{% sections \'header-group\' %}<main>{{ content_for_layout }}</main>{%- sections "footer-group" -%}</body>',
  'locales/en.default.schema.json': `${SHOPIFY_NOTICE}{ "sections": { "rich-text": { "name": "Rich text", }, }, }`,
  'sections/rich-text.liquid': schema('t:sections.rich-text.name'),
  'sections/hero-banner.liquid': `{% comment %}Hero{% endcomment %}\n{% if template == 'index' %}<img>{% endif %}\n${schema('Hero banner')}`,
  'sections/header-group.json': {
    type: 'header',
    name: 'Header group',
    sections: {
      nav: { type: 'apps', blocks: { a: { type: 'shopify://apps/mega-nav/blocks/header/123', settings: {} } } },
      hero: { type: 'hero-banner', settings: { heading: '<p>Sea   To Me</p>' } },
    },
    order: ['nav', 'hero'],
  },
  'sections/footer-group.json': { type: 'footer', sections: { footer: { type: 'footer' } }, order: ['footer'] },
  'templates/index.json': `${SHOPIFY_NOTICE}{
    "sections": {
      "intro": { "type": "rich-text", "name": "Test - Builder", "blocks": { "h": { "type": "heading", "settings": { "heading": "Say \\"hi\\"" } } }, "block_order": ["h"] },
      "old": { "type": "rich-text", "disabled": true, "settings": {} },
      "ghost": { "type": "rich-text" },
    },
    "order": ["intro", "old", "missing"],
  }`,
  'templates/product.json': { sections: { main: { type: 'main-product' } }, order: ['main'] },
  'templates/page.about-us.json': { layout: false, sections: { main: { type: 'main-page' } }, order: ['main'] },
  'templates/page.carmel.liquid': '<h1>Carmel</h1>',
  'templates/customers/account.liquid': '{{ customer.name }}',
}

test('the outline lists what visitors see, layout groups around the homepage content', async () => {
  const root = await theme(store)
  const outline = await buildPageOutline(root, 'Move the test section to the top of the page')
  const lines = outline.split('\n')
  const at = (text) => lines.findIndex((line) => line.includes(text))

  assert.ok(at('Section group "header-group"') < at('Homepage (templates/index.json'))
  assert.ok(at('Homepage (templates/index.json') < at('id intro'))
  assert.ok(at('Before the page content') < at('id hero'))
  assert.ok(at('After the page content') < at('Section group "footer-group"'))
  assert.match(outline, /1\. "apps" · type apps · id nav · app: mega-nav/)
  assert.match(
    outline,
    /"Hero banner" · type hero-banner · id hero · shows only if template == 'index' · text "Sea To Me"/,
  )
  assert.match(outline, /1\. "Test - Builder" · type rich-text · id intro · text "Say 'hi'"/)
  assert.match(outline, /2\. \[hidden\] "Rich text" · type rich-text · id old/)
  assert.doesNotMatch(outline, /missing|ghost/)
  assert.match(
    outline,
    /Other templates \(not outlined here; read them if needed\): page\.about-us, page\.carmel, product, customers\/account/,
  )
  await rm(root, { recursive: true, force: true })
})

test('templates the request names are outlined too', async () => {
  const root = await theme(store)
  const outline = await buildPageOutline(root, 'Change the About Us page and the product page; also Carmel')
  assert.match(
    outline,
    /Template "page\.about-us" \(templates\/page\.about-us\.json, no layout\), page content:\n {2}1\. "main-page"/,
  )
  assert.match(outline, /Template "product" \(templates\/product\.json, layout "theme"\)/)
  assert.match(outline, /Template "page\.carmel" \(templates\/page\.carmel\.liquid\) is a Liquid template/)
  assert.match(outline, /read them if needed\): customers\/account$/)
  await rm(root, { recursive: true, force: true })
})

test('missing or broken files are marked, and an empty workspace gives no outline', async () => {
  const root = await theme({
    'layout/theme.liquid': "{% sections 'header-group' %}{{ content_for_layout }}",
    'templates/index.json': '{ not json',
  })
  const outline = await buildPageOutline(root, 'hi')
  assert.match(outline, /Section group "header-group" \(sections\/header-group\.json\): could not be read\./)
  assert.match(outline, /Homepage \(templates\/index\.json\) could not be read\./)
  assert.equal(await buildPageOutline(path.join(root, 'nope'), 'hi'), '')
  await rm(root, { recursive: true, force: true })
})
