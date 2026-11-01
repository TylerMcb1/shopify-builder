// Claude Agent SDK wiring (README 6.2, 10.1–10.3, 10.6).
// This is the only module that imports the SDK. Tests use buildQueryOptions and never call runTurn.
import { APP_MCP_TOOLS, ALLOWED_BUILTIN_TOOLS, DISALLOWED_TOOLS } from './runtime-policy.mjs'

export { APP_MCP_TOOLS, ALLOWED_BUILTIN_TOOLS, DISALLOWED_TOOLS } from './runtime-policy.mjs'

const SERVER_NAME = 'shopify-builder'

export function buildQueryOptions(ctx, mcpServer) {
  const controller = new AbortController()
  if (ctx.signal.aborted) controller.abort(ctx.signal.reason)
  else ctx.signal.addEventListener('abort', () => controller.abort(ctx.signal.reason), { once: true })

  return {
    cwd: ctx.workspaceRoot,
    resume: ctx.resumeSessionId ?? undefined,
    abortController: controller,
    tools: [...ALLOWED_BUILTIN_TOOLS],
    // Only the app's own tools are pre-approved. A theme file tool listed here would skip canUseTool,
    // and with it the path policy and the approval pop-up for sensitive files.
    allowedTools: [...APP_MCP_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    // Empty list: do not load CLAUDE.md, .claude, or user settings from the workspace.
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    permissionMode: 'default',
    maxTurns: ctx.maxTurns,
    systemPrompt: ctx.systemPrompt,
    persistSession: true,
    mcpServers: { [SERVER_NAME]: mcpServer },
    canUseTool: async (toolName, input) => {
      if (toolName === APP_MCP_TOOLS[0] || toolName === APP_MCP_TOOLS[1]) return { behavior: 'allow' }
      if (!ALLOWED_BUILTIN_TOOLS.includes(toolName)) {
        return { behavior: 'deny', message: 'That tool is not available in Shopify Builder.' }
      }
      return ctx.hooks.canUseTool(toolName, input)
    },
  }
}

/** A plain string, or one user message with the screenshot first when the host sent one. */
export function buildPrompt(ctx) {
  if (!ctx.image) return ctx.prompt
  const message = {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: ctx.image.mediaType, data: ctx.image.data } },
        { type: 'text', text: ctx.prompt },
      ],
    },
  }
  return (async function* () {
    yield message
  })()
}

export async function runTurn(ctx) {
  const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
  const { z } = await import('zod')
  let summary = ''
  let warnings = []
  let pageTypes = []
  let reported = false
  let outOfTurns = false
  let sessionId = ctx.resumeSessionId

  const askUser = tool(
    'ask_user',
    'Ask the merchant one short clarifying question when the request is ambiguous.',
    { question: z.string() },
    async (args) => {
      const answer = await ctx.hooks.ask(String(args.question ?? ''))
      return { content: [{ type: 'text', text: answer }] }
    },
    { alwaysLoad: true },
  )
  const reportStep = tool(
    'report_step',
    'Finish this step. summary: one or two plain sentences on what changed and where it shows. warnings: only what the merchant must act on. pageTypes: the page types likely affected.',
    {
      summary: z.string(),
      warnings: z.array(z.string()).optional(),
      pageTypes: z.array(z.string()).optional(),
    },
    async (args) => {
      reported = true
      summary = String(args.summary ?? '')
      warnings = Array.isArray(args.warnings) ? args.warnings.map(String) : []
      pageTypes = Array.isArray(args.pageTypes) ? args.pageTypes.map(String) : []
      return { content: [{ type: 'text', text: 'recorded' }] }
    },
    { alwaysLoad: true },
  )
  const mcpServer = createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [askUser, reportStep],
  })
  const options = buildQueryOptions(ctx, mcpServer)

  try {
    for await (const message of query({ prompt: buildPrompt(ctx), options })) {
      if (ctx.signal.aborted) break
      if (message && typeof message.session_id === 'string') sessionId = message.session_id
      if (message?.type === 'result' && message.subtype === 'error_max_turns') outOfTurns = true
      if (message?.type === 'assistant' && Array.isArray(message.message?.content)) {
        const text = message.message.content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
        // Text after report_step repeats the summary the app already shows.
        if (text.trim() && !reported) ctx.hooks.onAssistant(text)
      }
    }
  } catch (err) {
    // The SDK can throw a generic error after an error result; the result already said why.
    if (!outOfTurns) throw err
  }

  if (outOfTurns && !reported) throw Object.assign(new Error('max_turns'), { code: 'max_turns' })
  if (!reported) warnings = [...warnings, 'Claude did not report a structured result.']
  return { sessionId, summary, warnings, pageTypes }
}
