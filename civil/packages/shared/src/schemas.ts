import { z } from 'zod'

export const CreatePostInput = z.object({
  body: z.string().min(1).max(5000),
  mediaUrl: z.string().url().optional(),
  hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,50}$/)).max(10).optional(),
})

export type CreatePostInput = z.infer<typeof CreatePostInput>

export const LikePostInput = z.object({
  postId: z.string().cuid(),
})

export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const HandleParam = z.object({ handle: z.string().min(3).max(32) })
