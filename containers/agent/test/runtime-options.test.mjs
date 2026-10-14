import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQueryOptions, ALLOWED_BUILTIN_TOOLS, APP_MCP_TOOLS, DISALLOWED_TOOLS } from '../src/claude-runtime.mjs'

test('query options allow only theme file tools and the two app tools', async () => {
  const calls = []
  const options = buildQueryOptions(
    {
      workspaceRoot: '/workspace',
      resumeSessionId: null,
      signal: new AbortController().signal,
      maxTurns: 8,
      systemPrompt: 'Edit the theme.',
      hooks: {
        canUseTool: async (name) => {
          calls.push(name)
          return { behavior: 'allow' }
        },
      },
    },
    { type: 'sdk', name: 'shopify-builder' },
  )

  assert.deepEqual(options.tools, ALLOWED_BUILTIN_TOOLS)
  assert.deepEqual(options.allowedTools, [...ALLOWED_BUILTIN_TOOLS, ...APP_MCP_TOOLS])
  for (const name of ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task', 'Skill']) {
    assert.ok(DISALLOWED_TOOLS.includes(name), name)
    assert.ok(options.disallowedTools.includes(name), name)
  }
  assert.deepEqual(options.settingSources, [])
  assert.deepEqual(options.skills, [])
  assert.equal(options.strictMcpConfig, true)
  assert.equal(options.permissionMode, 'default')
  assert.equal(options.persistSession, true)
  assert.equal(options.env, undefined)
  assert.equal(Object.hasOwn(options, 'additionalDirectories'), false)
  assert.equal(options.mcpServers['shopify-builder'].name, 'shopify-builder')
  assert.equal(options.cwd, '/workspace')
  assert.equal(options.resume, undefined)

  assert.equal((await options.canUseTool('Bash', { command: 'ls' })).behavior, 'deny')
  assert.equal((await options.canUseTool('mcp__other__fetch', {})).behavior, 'deny')
  assert.equal((await options.canUseTool(APP_MCP_TOOLS[0], {})).behavior, 'allow')
  assert.equal((await options.canUseTool(APP_MCP_TOOLS[1], {})).behavior, 'allow')
  assert.equal((await options.canUseTool('Read', { file_path: '/workspace/sections/a.liquid' })).behavior, 'allow')
  assert.deepEqual(calls, ['Read'])
})

test('an aborted turn aborts the query controller', () => {
  const controller = new AbortController()
  controller.abort('timeout')
  const options = buildQueryOptions(
    {
      workspaceRoot: '/workspace',
      resumeSessionId: '11111111-1111-4111-8111-111111111111',
      signal: controller.signal,
      maxTurns: 8,
      systemPrompt: 'x',
      hooks: { canUseTool: async () => ({ behavior: 'allow' }) },
    },
    { type: 'sdk' },
  )
  assert.equal(options.abortController.signal.aborted, true)
  assert.equal(options.resume, '11111111-1111-4111-8111-111111111111')
})
