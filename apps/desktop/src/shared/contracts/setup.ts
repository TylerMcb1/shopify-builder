import { z } from 'zod'

export const SetupStatusSchema = z.object({
  docker: z.object({
    state: z.enum(['ready', 'not-running', 'windows-containers', 'too-old', 'unavailable']),
    message: z.string().min(1).max(400),
    version: z.string().nullable(),
    os: z.string().nullable(),
  }),
  images: z.object({
    ready: z.boolean(),
    status: z.enum(['ready', 'missing', 'downloading', 'mismatch', 'unpinned', 'invalid-manifest']),
    message: z.string().min(1).max(400),
    images: z
      .array(
        z.object({
          name: z.enum(['base', 'agent', 'shopify', 'gateway']),
          ref: z.string().max(200),
          status: z.enum(['match', 'missing', 'mismatch', 'unpinned']),
          message: z.string().min(1).max(200),
        }),
      )
      .length(4),
  }),
})

export type SetupStatus = z.infer<typeof SetupStatusSchema>

export const OpenExternalResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().max(200),
})

export type OpenExternalResult = z.infer<typeof OpenExternalResultSchema>

export const LINK_DENIED = "That link can't be opened from Shopify Builder."
