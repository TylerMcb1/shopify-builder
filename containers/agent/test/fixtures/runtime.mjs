// Stand-in for the Claude Agent SDK. The runner loads this only when AGENT_TEST_RUNTIME=1.
import { writeFileSync } from 'node:fs'

const SESSION = '11111111-1111-4111-8111-111111111111'

export async function runTurn(ctx) {
  const scenario = process.env.AGENT_SCENARIO || 'echo'
  if (scenario === 'sensitive') {
    ctx.hooks.onAssistant('I need to change your theme settings.')
    const decision = await ctx.hooks.canUseTool('Write', {
      file_path: `${ctx.workspaceRoot}/config/settings_data.json`,
    })
    const summary = decision.behavior === 'allow' ? 'Updated the theme settings.' : 'I left your theme settings alone.'
    return { sessionId: SESSION, summary, warnings: [], pageTypes: ['index', 'not-a-page'] }
  }
  if (scenario === 'blocked') {
    const decision = await ctx.hooks.canUseTool('Write', { file_path: `${ctx.workspaceRoot}/layout/checkout.liquid` })
    return { sessionId: SESSION, summary: `blocked ${decision.behavior}`, warnings: [], pageTypes: [] }
  }
  if (scenario === 'question') {
    const answer = await ctx.hooks.ask('Which color?')
    return { sessionId: SESSION, summary: `You chose ${answer}.`, warnings: [], pageTypes: ['index'] }
  }
  if (scenario === 'resume') {
    return { sessionId: SESSION, summary: `resumed ${ctx.resumeSessionId ?? 'none'}`, warnings: [], pageTypes: [] }
  }
  if (scenario === 'theme-step' || scenario === 'always-broken') {
    const fixing = scenario === 'theme-step' && typeof ctx.prompt === 'string' && ctx.prompt.startsWith('Theme Check')
    writeFileSync(`${ctx.workspaceRoot}/sections/hero.liquid`, fixing ? 'hello fixed\n' : 'broken {{\n')
    return {
      sessionId: SESSION,
      summary: fixing ? 'Fixed the hero.' : 'Updated the hero.',
      warnings: [],
      pageTypes: ['index', 'product'],
    }
  }
  if (scenario === 'settings-backstop') {
    writeFileSync(`${ctx.workspaceRoot}/config/settings_data.json`, '{"current":"Changed"}\n')
    return { sessionId: SESSION, summary: 'Changed settings.', warnings: [], pageTypes: ['index'] }
  }
  if (scenario === 'secret') {
    ctx.hooks.onAssistant('sk-ant-' + 'a'.repeat(20))
    return { sessionId: SESSION, summary: 'Done.', warnings: [], pageTypes: [] }
  }
  return { sessionId: SESSION, summary: 'Done.', warnings: [], pageTypes: ['index'] }
}
