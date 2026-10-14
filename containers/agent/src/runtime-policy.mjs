// Tool allowlist for the agent container (README 6.2). Kept separate so tests can import it
// without loading the Claude Agent SDK.
export const ALLOWED_BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep']

export const DISALLOWED_TOOLS = ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task', 'Skill']

export const APP_MCP_TOOLS = ['mcp__shopify-builder__ask_user', 'mcp__shopify-builder__report_step']
