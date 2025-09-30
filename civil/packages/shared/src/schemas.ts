import { z } from 'zod'

export const PostTypeEnum = z.enum(['post', 'article'])

export const CreatePostInput = z
  .object({
    type: PostTypeEnum.default('post'),
    title: z
      .string()
      .trim()
      .min(3, { message: 'Title must be at least 3 characters' })
      .max(160, { message: 'Title is too long' })
      .optional(),
    body: z.string().min(1).max(20000),
    mediaUrl: z.string().url().optional(),
    hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,50}$/)).max(10).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'article') {
      if (!data.title) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Article title is required',
          path: ['title'],
        })
      }
      const plain = data.body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
      if (plain.length < 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Articles should be at least 100 characters',
          path: ['body'],
        })
      }
    } else {
      if (data.body.length > 5000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Posts must be 5000 characters or less',
          path: ['body'],
        })
      }
    }
  })

export type CreatePostInput = z.infer<typeof CreatePostInput>

export type PostType = z.infer<typeof PostTypeEnum>

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
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(40),
  password: z.string().min(8).max(72),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms' }),
  }),
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

export const SetHomeChamberInput = z.object({
  provinceCode: z.string().min(2).max(2),
  chamberSlug: z.string().min(1).max(120),
})
export type SetHomeChamberInput = z.infer<typeof SetHomeChamberInput>

export const FollowChamberInput = z.object({
  provinceCode: z.string().min(2).max(2),
  chamberSlug: z.string().min(1).max(120),
  setAsHome: z.boolean().optional(),
})
export type FollowChamberInput = z.infer<typeof FollowChamberInput>

export const UnfollowChamberInput = z.object({
  provinceCode: z.string().min(2).max(2),
  chamberSlug: z.string().min(1).max(120),
})
export type UnfollowChamberInput = z.infer<typeof UnfollowChamberInput>

export const UpdateProfileInput = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(60),
  bio: z
    .string()
    .max(10000, { message: 'Bio must be 10,000 characters or fewer' })
    .optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>
