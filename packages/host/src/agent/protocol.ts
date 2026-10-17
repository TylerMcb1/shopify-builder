// Schemas for the agent runner protocol (README 6.2, 18).
// The host treats every runner line as untrusted and drops the session when a line does not match.
import { z } from 'zod'

export const SessionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{7,63}$/)
export const RequestIdSchema = z.string().uuid()

export function isThemePath(value: string): boolean {
  if (value.length < 1 || value.length > 240) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('//')) return false
  return value.split('/').every((part) => {
    if (part.length === 0 || part === '.' || part === '..' || part.startsWith('.')) return false
    return /^[a-zA-Z0-9_-]+([ .][a-zA-Z0-9_-]+)*$/.test(part)
  })
}

export const ThemePathSchema = z.string().refine(isThemePath, 'bad theme path')

export const AGENT_MAX_TURNS = 8
export const AGENT_MAX_REPAIRS = 2
/** In-container limit. The host's limit is a little longer so a timeout can be reported first. */
export const RUNNER_STEP_TIMEOUT_MS = 10 * 60 * 1000
export const AGENT_STEP_TIMEOUT_MS = RUNNER_STEP_TIMEOUT_MS + 15_000
export const AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const AGENT_READY_TIMEOUT_MS = 15_000

export const SESSION_MESSAGES = {
  malformed: 'The change assistant stopped responding, so I closed it.',
  timeout: 'This step took too long, so I stopped.',
  idle: 'The change assistant was idle too long, so I closed it.',
  cancelled: 'Stopped.',
  model: "Couldn't finish this step.",
  credential: 'Remove the secret from your message and try again.',
  busy: 'A change is already running.',
  notReady: 'The change assistant is still starting.',
  noSession: 'There is no change in progress.',
  repairLimit: "I couldn't make this change without errors. Your theme hasn't changed.",
  unexpected: "That request wasn't understood.",
  didNotStart: 'The change assistant did not start.',
} as const

export const PROGRESS_LABELS = {
  preparing_workspace: 'Preparing workspace',
  preparing_preview: 'Preparing preview',
  thinking: 'Working on your change…',
  making_changes: 'Updating theme files…',
  checking: 'Checking the theme…',
  repairing: 'Fixing a problem I found…',
  updating_preview: 'Updating preview',
} as const

export const KNOWN_PAGE_TYPES = [
  'index',
  'product',
  'collection',
  'list-collections',
  'page',
  'blog',
  'article',
  'cart',
  'search',
  '404',
  'password',
  'gift_card',
  'customers/account',
  'customers/login',
  'customers/order',
  'customers/register',
  'customers/reset_password',
  'customers/activate_account',
  'customers/addresses',
] as const

const RunnerProgressStage = z.enum(['thinking', 'making_changes', 'checking', 'repairing'])
const SessionProgressStage = z.enum([
  'preparing_workspace',
  'preparing_preview',
  'thinking',
  'making_changes',
  'checking',
  'repairing',
  'updating_preview',
])
const ErrorCode = z.enum(['timeout', 'malformed', 'protocol', 'model', 'cancelled'])

export const RunnerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('progress'), stage: RunnerProgressStage }).strict(),
  z.object({ type: z.literal('assistant'), text: z.string().min(1).max(8000) }).strict(),
  z
    .object({
      type: z.literal('approval_request'),
      requestId: RequestIdSchema,
      files: z
        .array(z.object({ path: ThemePathSchema, description: z.string().min(1).max(500) }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
  z.object({ type: z.literal('question'), requestId: RequestIdSchema, text: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      type: z.literal('step_result'),
      summary: z.string().min(1).max(8000),
      warnings: z.array(z.string().max(500)).max(20),
      pageTypes: z.array(z.string().max(40)).max(20),
      sensitiveApproved: z.array(ThemePathSchema).max(50),
    })
    .strict(),
  z.object({ type: z.literal('error'), code: ErrorCode, message: z.string().min(1).max(400) }).strict(),
])

export type RunnerMessage = z.infer<typeof RunnerMessageSchema>

const identity = {
  sessionId: SessionIdSchema,
  seq: z.number().int().positive(),
}

export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({ ...identity, type: z.literal('progress'), stage: SessionProgressStage, label: z.string().min(1).max(200) }).strict(),
  z.object({ ...identity, type: z.literal('assistant'), text: z.string().min(1).max(8000) }).strict(),
  z
    .object({
      ...identity,
      type: z.literal('approval_request'),
      requestId: RequestIdSchema,
      files: z
        .array(z.object({ path: ThemePathSchema, description: z.string().min(1).max(500) }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
  z.object({ ...identity, type: z.literal('question'), requestId: RequestIdSchema, text: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      ...identity,
      type: z.literal('step_result'),
      summary: z.string().min(1).max(8000),
      warnings: z.array(z.string().max(500)).max(20),
      pageTypes: z.array(z.enum(KNOWN_PAGE_TYPES)).max(20),
      sensitiveApproved: z.array(ThemePathSchema).max(50),
    })
    .strict(),
  z.object({ ...identity, type: z.literal('error'), code: ErrorCode, message: z.string().min(1).max(400) }).strict(),
  z
    .object({
      ...identity,
      type: z.literal('step_ready'),
      summary: z.string().min(1).max(8000),
      warnings: z.array(z.string().max(500)).max(20),
      files: z.array(z.object({ path: ThemePathSchema, status: z.enum(['added', 'modified']) }).strict()).max(200),
      sensitiveApproved: z.array(ThemePathSchema).max(50),
    })
    .strict(),
  z
    .object({
      ...identity,
      type: z.literal('validation_blocked'),
      message: z.string().min(1).max(400),
      canRetry: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...identity, type: z.literal('step_undone'), message: z.string().min(1).max(400) }).strict(),
  z.object({ ...identity, type: z.literal('steps_cleared'), message: z.string().min(1).max(400) }).strict(),
  z.object({
    ...identity,
    type: z.literal('preview_ready'),
    pages: z.array(z.enum(KNOWN_PAGE_TYPES)).max(8),
    previewThemeId: z.number().int().positive().optional(),
  }).strict(),
  z.object({ ...identity, type: z.literal('drift_confirm'), message: z.string().min(1).max(400) }).strict(),
  z
    .object({
      ...identity,
      type: z.literal('saved'),
      themeName: z.string().min(1).max(255),
      changeId: z.string().uuid(),
      title: z.string().min(1).max(120),
    })
    .strict(),
  z.object({ ...identity, type: z.literal('discarded') }).strict(),
])

export type SessionEvent = z.infer<typeof SessionEventSchema>

export type SessionBody = {
  [K in SessionEvent['type']]: Omit<Extract<SessionEvent, { type: K }>, 'sessionId' | 'seq'>
}[SessionEvent['type']]

export const RepairProblemSchema = z
  .object({
    file: ThemePathSchema,
    check: z.string().min(1).max(120),
    message: z.string().min(1).max(500),
  })
  .strict()

export const HostToRunnerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), resume: z.boolean() }).strict(),
  z.object({ type: z.literal('user_message'), text: z.string().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('approval'), requestId: RequestIdSchema, decision: z.enum(['approve', 'decline']) }).strict(),
  z.object({ type: z.literal('question_answer'), requestId: RequestIdSchema, text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('repair'), problems: z.array(RepairProblemSchema).min(1).max(30) }).strict(),
  z.object({ type: z.literal('cancel') }).strict(),
])

export type HostToRunner = z.infer<typeof HostToRunnerSchema>

export const StartSessionInputSchema = z
  .object({
    storeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    themeId: z.number().int().positive(),
    resumeSessionId: SessionIdSchema.optional(),
    storeDomain: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/)
      .optional(),
  })
  .strict()

export const SendMessageInputSchema = z.object({ text: z.string().min(1).max(8000) }).strict()

export const ApprovalDecisionInputSchema = z
  .object({
    requestId: RequestIdSchema,
    decision: z.enum(['approve', 'decline']),
  })
  .strict()

export const QuestionAnswerInputSchema = z
  .object({
    requestId: RequestIdSchema,
    text: z.string().min(1).max(2000),
  })
  .strict()

export const SessionCommandResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().max(400).optional(),
    sessionId: SessionIdSchema.optional(),
    status: z.enum(['confirm', 'saved', 'blocked', 'conflict']).optional(),
  })
  .strict()

export type SessionCommandResult = z.infer<typeof SessionCommandResultSchema>
export type StartSessionInput = z.infer<typeof StartSessionInputSchema>
