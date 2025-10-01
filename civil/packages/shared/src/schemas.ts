import { z } from 'zod'
import { normalizeProvinceCode } from './chambers.js'

export const PostTypeEnum = z.enum(['post', 'article'])

export const JurisdictionEnum = z.enum(['citizen', 'municipal', 'provincial', 'federal'])
export type Jurisdiction = z.infer<typeof JurisdictionEnum>

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
    chamberProvince: z.string().trim().min(2).max(32).optional(),
    chamberSlug: z.string().trim().min(1).max(160).optional(),
    jurisdiction: JurisdictionEnum.optional(),
  })
  .superRefine((data, ctx) => {
    const hasProvince = typeof data.chamberProvince === 'string' && data.chamberProvince.trim().length > 0
    const hasChamberSlug = typeof data.chamberSlug === 'string' && data.chamberSlug.trim().length > 0

    if (hasProvince !== hasChamberSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chamber province and slug must both be provided to target a chamber',
        path: hasProvince ? ['chamberSlug'] : ['chamberProvince'],
      })
    }

    if (hasProvince) {
      const normalized = normalizeProvinceCode(data.chamberProvince)
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Province code is not recognized',
          path: ['chamberProvince'],
        })
      }
    }

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
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
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

export const ChamberGeoMatchSchema = z.object({
  province: z.string().min(2).max(2),
  chamberSlug: z.string().min(1).max(160),
  chamberName: z.string().min(1).max(160),
  method: z.enum(['geofenced', 'nearest']),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  distanceKm: z.number().nonnegative().optional(),
})
export type ChamberGeoMatch = z.infer<typeof ChamberGeoMatchSchema>

export const ChamberGeolocateResponseSchema = z.object({
  primary: ChamberGeoMatchSchema.nullable(),
  alternatives: z.array(ChamberGeoMatchSchema),
  meta: z
    .object({
      source: z.string().default('elections_canada'),
      cached: z.boolean().optional(),
      fetchedAt: z.string().optional(),
      features: z.number().optional(),
    })
    .optional(),
})
export type ChamberGeolocateResponse = z.infer<typeof ChamberGeolocateResponseSchema>

export const ChamberGeolocateInput = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(25).default(8).optional(),
  bboxPaddingDegrees: z.coerce.number().min(0).max(5).default(0.25).optional(),
})
export type ChamberGeolocateInput = z.infer<typeof ChamberGeolocateInput>

export const ExperienceInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    organization: z.string().trim().min(1).max(160),
    location: z.string().trim().max(160).optional(),
    startDate: z.string().datetime({ message: 'start_date_invalid' }),
    endDate: z.string().datetime({ message: 'end_date_invalid' }).nullable().optional(),
    current: z.boolean().default(false),
    description: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, ctx) => {
    const start = new Date(value.startDate)
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start_date_invalid', path: ['startDate'] })
      return
    }

    if (!value.current && !value.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end_date_required', path: ['endDate'] })
      return
    }

    if (value.endDate) {
      const end = new Date(value.endDate)
      if (Number.isNaN(end.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end_date_invalid', path: ['endDate'] })
        return
      }

      if (end.getTime() < start.getTime()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end_before_start', path: ['endDate'] })
      }
    }
  })
export type ExperienceInput = z.infer<typeof ExperienceInput>

export const UpdateProfileInput = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(60),
  bio: z
    .string()
    .max(10000, { message: 'Bio must be 10,000 characters or fewer' })
    .optional(),
  experiences: z.array(ExperienceInput).max(50, { message: 'experience_limit' }).optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>
