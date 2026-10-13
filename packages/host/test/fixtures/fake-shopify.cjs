// Stand-in for the Shopify CLI inside the container. Behaviour is selected with FAKE_SHOPIFY_SCENARIO.
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const scenario = process.env.FAKE_SHOPIFY_SCENARIO || 'ok'
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

if (!process.env.SHOPIFY_CLI_THEME_TOKEN || process.env.SHOPIFY_CLI_THEME_TOKEN !== process.env.FAKE_EXPECT_TOKEN) {
  process.stderr.write('Error: Invalid Theme Access password\n')
  process.exit(1)
}

if (args[0] === 'theme' && args[1] === 'list') {
  if (scenario === 'bad-list') {
    process.stdout.write('not json\n')
    process.exit(0)
  }
  const themes = process.env.FAKE_THEMES
    ? JSON.parse(process.env.FAKE_THEMES)
    : [
        { id: 111, name: 'Dawn', role: 'live' },
        { id: 222, name: '[Builder] Working copy', role: 'unpublished' },
      ]
  process.stdout.write(JSON.stringify(themes) + '\n')
  process.exit(0)
}

if (args[0] === 'theme' && args[1] === 'pull') {
  const inbox = process.env.FAKE_INBOX
  if (flag('--path') !== '/inbox' || !inbox) {
    process.stderr.write('pull: unexpected path\n')
    process.exit(1)
  }
  if (scenario === 'pull-fails') {
    process.stderr.write(`Error: upstream failed for token ${process.env.SHOPIFY_CLI_THEME_TOKEN}\n`)
    process.exit(1)
  }
  if (scenario === 'empty') process.exit(0)

  const version = process.env.FAKE_PULL_VERSION || '1'
  const files = {
    'layout/theme.liquid': `<html>{{ content_for_layout }} v${version}</html>`,
    'sections/header.liquid': '<header>{{ shop.name }}</header>',
    'config/settings_data.json': '{"current":"Default"}',
    'templates/index.json': '{"sections":{},"order":[]}',
    'locales/en.default.json': '{"general":{}}',
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    // Everything below must be rejected by intake.
    '.shopify/metafields.json': '{}',
    'layout/checkout.liquid': '<checkout/>',
    'shopify.theme.toml': '[environments]',
    'snippets/leak.liquid': 'token: shptka_0123456789abcdef0123456789abcdef',
    'snippets/latin1.liquid': Buffer.from([0x63, 0x61, 0x66, 0xe9]),
  }
  if (version === '1') files['snippets/old-only.liquid'] = 'removed in v2'
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(inbox, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
  }
  fs.symlinkSync('/etc/passwd', path.join(inbox, 'snippets', 'link.liquid'))
  process.stdout.write(`Theme pulled successfully (${flag('--theme')})\n`)
  process.exit(0)
}

process.stderr.write(`fake shopify: unsupported ${args.join(' ')}\n`)
process.exit(1)
