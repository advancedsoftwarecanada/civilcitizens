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

// Auth
export const RegisterInput = z.object({
  email: z.string().email(),
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  name: z.string().min(2).max(60).optional(),
  password: z.string().min(8).max(72),
})
export type RegisterInput = z.infer<typeof RegisterInput>

export const LoginInput = z.object({
  emailOrHandle: z.string().min(3).max(254),
  password: z.string().min(8).max(72),
})
export type LoginInput = z.infer<typeof LoginInput>

export const ForgotPasswordInput = z.object({
  emailOrHandle: z.string().min(3).max(254),
})
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>

export const ResetPasswordInput = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(72),
})
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>
