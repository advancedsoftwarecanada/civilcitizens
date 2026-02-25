import { z } from 'zod'
import { normalizeProvinceCode } from './chambers.js'

export const PostTypeEnum = z.enum(['post', 'article', 'photo'])

export const PostVisibilityEnum = z.enum(['public', 'members'])
export type PostVisibility = z.infer<typeof PostVisibilityEnum>

export const PostAudienceEnum = z.enum(['friends', 'network'])
export type PostAudience = z.infer<typeof PostAudienceEnum>

export const JurisdictionEnum = z.enum(['self', 'municipal', 'provincial', 'federal'])
export type Jurisdiction = z.infer<typeof JurisdictionEnum>

export const CreatePostInput = z
  .object({
    type: PostTypeEnum.default('post'),
    businessId: z.string().cuid().optional(),
    audience: PostAudienceEnum.optional(),
    visibility: PostVisibilityEnum.optional(),
    title: z
      .string()
      .trim()
      .min(3, { message: 'Title must be at least 3 characters' })
      .max(160, { message: 'Title is too long' })
      .optional(),
    body: z.string().max(20000).optional(),
    mediaUrl: z.string().url().optional(),
    images: z.array(z.string().url()).optional(),
    hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,50}$/)).max(10).optional(),
    communityProvince: z.string().trim().min(2).max(32).optional(),
    communitySlug: z.string().trim().min(1).max(160).optional(),
    jurisdiction: JurisdictionEnum.optional(),
    sharedPostId: z.string().cuid().optional(),
  })
  .superRefine((data, ctx) => {
    const hasBusinessId = typeof data.businessId === 'string' && data.businessId.trim().length > 0
    const hasProvince = typeof data.communityProvince === 'string' && data.communityProvince.trim().length > 0
    const hasCommunitySlug = typeof data.communitySlug === 'string' && data.communitySlug.trim().length > 0

    if (data.visibility === 'members' && !hasBusinessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Members-only visibility is only supported for organization posts',
        path: ['visibility'],
      })
    }

    if (!hasBusinessId && hasProvince !== hasCommunitySlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Community province and slug must both be provided to target a community',
        path: hasProvince ? ['communitySlug'] : ['communityProvince'],
      })
    }

    if (!hasBusinessId && hasProvince) {
      const normalized = normalizeProvinceCode(data.communityProvince)
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Province code is not recognized',
          path: ['communityProvince'],
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
      const bodyValue = data.body ?? ''
      const plain = bodyValue.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
      if (plain.length < 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Articles should be at least 100 characters',
          path: ['body'],
        })
      }
    } else if (data.type === 'photo') {
      if (!data.mediaUrl && (!data.images || data.images.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Photo posts require an image',
          path: ['mediaUrl'],
        })
      }
      const captionLength = (data.body ?? '').trim().length
      if (captionLength > 5000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Captions must be 5000 characters or less',
          path: ['body'],
        })
      }
    } else {
      const bodyLength = (data.body ?? '').length
      if (bodyLength < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Posts must include some text',
          path: ['body'],
        })
      }
      if (bodyLength > 5000) {
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

export const ReactionTypeEnum = z.enum(['maple', 'heart', 'haha', 'wow', 'sad', 'fire'])
export type ReactionType = z.infer<typeof ReactionTypeEnum>

export const ReactPostInput = z.object({
  postId: z.string().cuid(),
  reaction: ReactionTypeEnum.nullable(),
})
export type ReactPostInput = z.infer<typeof ReactPostInput>

export const VoteValueSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)])
export type VoteValue = z.infer<typeof VoteValueSchema>

export const VoteCommentInput = z.object({
  commentId: z.string().cuid(),
  value: VoteValueSchema,
})
export type VoteCommentInput = z.infer<typeof VoteCommentInput>

export const CreateCommentInput = z.object({
  postId: z.string().cuid(),
  body: z.string().trim().min(1).max(5000),
  parentId: z.string().cuid().optional(),
})
export type CreateCommentInput = z.infer<typeof CreateCommentInput>

export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const PostSortEnum = z.enum(['new', 'hot'])
export type PostSort = z.infer<typeof PostSortEnum>

export const CommentSortEnum = z.enum(['hot', 'new'])
export type CommentSort = z.infer<typeof CommentSortEnum>

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

export const SetHomeCommunityInput = z.object({
  provinceCode: z.string().min(2).max(2),
  communitySlug: z.string().min(1).max(120),
})
export type SetHomeCommunityInput = z.infer<typeof SetHomeCommunityInput>

export const FollowCommunityInput = z.object({
  provinceCode: z.string().min(2).max(2),
  communitySlug: z.string().min(1).max(120),
  setAsHome: z.boolean().optional(),
})
export type FollowCommunityInput = z.infer<typeof FollowCommunityInput>

export const UnfollowCommunityInput = z.object({
  provinceCode: z.string().min(2).max(2),
  communitySlug: z.string().min(1).max(120),
})
export type UnfollowCommunityInput = z.infer<typeof UnfollowCommunityInput>

export const CitySummarySchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(160),
  provinceCode: z.string().min(2).max(2),
  provinceName: z.string().min(1).max(160),
  communitySlug: z.string().min(1).max(160),
  communityName: z.string().min(1).max(160),
  latitude: z.number(),
  longitude: z.number(),
  population: z.number().int().nonnegative().nullable(),
  distanceKm: z.number().nonnegative().optional(),
})
export type CitySummary = z.infer<typeof CitySummarySchema>

export const CommunityGeoMatchSchema = z.object({
  province: z.string().min(2).max(2),
  communitySlug: z.string().min(1).max(160),
  communityName: z.string().min(1).max(160),
  method: z.enum(['geofenced', 'nearest']),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  distanceKm: z.number().nonnegative().optional(),
  city: CitySummarySchema.optional(),
})
export type CommunityGeoMatch = z.infer<typeof CommunityGeoMatchSchema>

export const CommunityGeolocateResponseSchema = z.object({
  primary: CommunityGeoMatchSchema.nullable(),
  alternatives: z.array(CommunityGeoMatchSchema),
  meta: z
    .object({
      source: z.string().default('elections_canada'),
      cached: z.boolean().optional(),
      fetchedAt: z.string().optional(),
      features: z.number().optional(),
    })
    .optional(),
})
export type CommunityGeolocateResponse = z.infer<typeof CommunityGeolocateResponseSchema>

export const CommunityGeolocateInput = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(25).default(8).optional(),
  bboxPaddingDegrees: z.coerce.number().min(0).max(5).default(0.25).optional(),
})
export type CommunityGeolocateInput = z.infer<typeof CommunityGeolocateInput>

export const PostalGeolocateInput = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(25).default(8).optional(),
  bboxPaddingDegrees: z.coerce.number().min(0).max(5).default(0.25).optional(),
})
export type PostalGeolocateInput = z.infer<typeof PostalGeolocateInput>

export const PostalLookupInput = z.object({
  postalCode: z.string().trim().min(3).max(12),
  limit: z.coerce.number().int().min(1).max(25).default(8).optional(),
})
export type PostalLookupInput = z.infer<typeof PostalLookupInput>

export const PostalLookupResponseSchema = z.object({
  postalCode: z.string(),
  fsa: z
    .object({
      code: z.string(),
      provinceCode: z.string().nullable(),
      subdivisionId: z.string().nullable(),
      subdivisionName: z.string().nullable(),
      centroidLat: z.number().nullable(),
      centroidLng: z.number().nullable(),
      defaultCommunitySlug: z.string().nullable(),
      defaultCommunityName: z.string().nullable(),
    })
    .nullable(),
  primary: CommunityGeoMatchSchema.nullable(),
  alternatives: z.array(CommunityGeoMatchSchema),
})
export type PostalLookupResponse = z.infer<typeof PostalLookupResponseSchema>

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

export const MediaAssetIdSchema = z.string().uuid().or(z.string().cuid())
export type MediaAssetId = z.infer<typeof MediaAssetIdSchema>

export const UpdateProfileInput = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(60),
  bio: z
    .string()
    .max(10000, { message: 'Bio must be 10,000 characters or fewer' })
    .optional(),
  experiences: z.array(ExperienceInput).max(50, { message: 'experience_limit' }).optional(),
  avatarMediaId: MediaAssetIdSchema.optional(),
  coverMediaId: MediaAssetIdSchema.optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>

export const UpdateProfilePhotoInput = z.object({
  category: z.enum(['avatar', 'cover']),
  displayAssetId: MediaAssetIdSchema,
  fullAssetId: MediaAssetIdSchema,
  caption: z
    .string()
    .trim()
    .max(5000, { message: 'caption_too_long' })
    .optional(),
})
export type UpdateProfilePhotoInput = z.infer<typeof UpdateProfilePhotoInput>

export const MediaCategoryEnum = z.enum(['avatar', 'cover', 'business_logo', 'business_cover', 'post_image', 'attachment'])
export type MediaCategory = z.infer<typeof MediaCategoryEnum>

export const RequestMediaUploadInput = z.object({
  category: MediaCategoryEnum,
  mime: z.string().trim().min(3).max(120),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  filename: z.string().trim().max(180).optional(),
})
export type RequestMediaUploadInput = z.infer<typeof RequestMediaUploadInput>

export const CompleteMediaUploadInput = z.object({
  assetId: MediaAssetIdSchema,
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  checksum: z.string().trim().max(160).optional(),
})
export type CompleteMediaUploadInput = z.infer<typeof CompleteMediaUploadInput>

// Messaging
export const CreateDirectThreadInput = z.object({
  // Accept cuid or uuid to stay compatible with legacy user ids
  userId: z.string().cuid().or(z.string().uuid()),
})
export type CreateDirectThreadInput = z.infer<typeof CreateDirectThreadInput>

export const CreateGroupThreadInput = z.object({
  participantIds: z
    .array(z.string().cuid().or(z.string().uuid()))
    .min(2)
    .max(20),
})
export type CreateGroupThreadInput = z.infer<typeof CreateGroupThreadInput>

export const GroupParticipantInput = z.object({
  userId: z.string().cuid().or(z.string().uuid()),
})
export type GroupParticipantInput = z.infer<typeof GroupParticipantInput>

export const SendMessageInput = z
  .object({
    body: z
      .string()
      .trim()
      .max(4000, { message: 'Message must be 4,000 characters or fewer' })
      .optional()
      .transform((value) => (value ? value.trim() : value)),
    attachments: z.array(z.string()).min(1).max(5).optional(),
  })
  .refine((value) => {
    const hasBody = typeof value.body === 'string' && value.body.length > 0
    const hasAttachments = Boolean(value.attachments?.length)
    return hasBody || hasAttachments
  }, { message: 'message_empty', path: ['body'] })
export type SendMessageInput = z.infer<typeof SendMessageInput>

export const MessageThreadListQuery = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type MessageThreadListQuery = z.infer<typeof MessageThreadListQuery>

export const MessageListQuery = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type MessageListQuery = z.infer<typeof MessageListQuery>

export const ThreadReadInput = z.object({
  messageId: z.string().cuid().optional(),
})
export type ThreadReadInput = z.infer<typeof ThreadReadInput>

export const UpdatePostInput = z.object({
  title: z
    .string()
    .trim()
    .min(3, { message: 'Title must be at least 3 characters' })
    .max(160, { message: 'Title is too long' })
    .optional(),
  body: z.string().max(20000).optional(),
  mediaUrl: z.string().url().optional().nullable(),
  hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_]{1,50}$/)).max(10).optional(),
})
