// Credential, history, and go-live payloads. These schemas never include a secret (README 7, 18).
import { z } from 'zod'

export const CredentialStatusSchema = z
  .object({
    claudeConnected: z.boolean(),
    claudeLast4: z.string().regex(/^[A-Za-z0-9_-]{4}$/).nullable(),
    claudeLocked: z.boolean(),
    storeDomain: z.string().nullable(),
  })
  .strict()

export type CredentialStatus = z.infer<typeof CredentialStatusSchema>

export const HistoryViewSchema = z
  .object({
    notice: z.string().max(200).nullable(),
    chats: z
      .array(
        z
          .object({
            chatId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
            themeId: z.number().int().positive(),
            title: z.string().max(120),
            activeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .strict(),
      )
      .max(200),
    changes: z
      .array(
        z
          .object({
            changeId: z.string().uuid(),
            themeId: z.number().int().positive(),
            title: z.string().max(120),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()

export type HistoryView = z.infer<typeof HistoryViewSchema>

export const ChatOpenSchema = z
  .object({
    title: z.string().max(120),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'claude']),
            text: z.string().max(4000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()

export type ChatOpen = z.infer<typeof ChatOpenSchema>

export const GoLiveViewSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.enum(['saved', 'check', 'live', 'preview']),
            label: z.string().max(80),
            passed: z.boolean(),
            detail: z.string().max(300),
          })
          .strict(),
      )
      .max(8),
    liveFiles: z.array(z.string().max(300)).max(200),
    conflicts: z.array(z.string().max(300)).max(200),
    instructions: z.array(z.string().max(200)).max(8),
    themesUrl: z.string().max(200).nullable(),
  })
  .strict()

export type GoLiveView = z.infer<typeof GoLiveViewSchema>

export const UpdateStatusSchema = z
  .object({
    message: z.string().max(200),
    canRestart: z.boolean(),
  })
  .strict()

export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

export const RoleNoticeSchema = z
  .object({
    notice: z.string().max(200).nullable(),
    rollbackLabel: z.string().max(120).nullable(),
    retiredThemeId: z.number().int().positive().nullable(),
  })
  .strict()

export type RoleNotice = z.infer<typeof RoleNoticeSchema>
