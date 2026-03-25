import { z } from 'zod'
import { normalizeProvinceCode } from './chambers.js'

export const PostTypeEnum = z.enum(['post', 'article', 'photo', 'poll'])
export const PollResultsVisibilityEnum = z.enum([
  'after_vote',
  'after_6_hours',
  'after_12_hours',
  'after_24_hours',
  'after_48_hours',
])
export type PollResultsVisibility = z.infer<typeof PollResultsVisibilityEnum>

export const PostVisibilityEnum = z.enum(['public', 'members'])
export type PostVisibility = z.infer<typeof PostVisibilityEnum>

export const PostAudienceEnum = z.enum(['friends', 'family', 'network', 'community', 'organization'])
export type PostAudience = z.infer<typeof PostAudienceEnum>

export const JurisdictionEnum = z.enum(['self', 'municipal', 'provincial', 'federal'])
export type Jurisdiction = z.infer<typeof JurisdictionEnum>

const PollOptionLabelSchema = z
  .string()
  .trim()
  .min(1, { message: 'Poll options cannot be empty' })
  .max(160, { message: 'Poll options must be 160 characters or fewer' })

export const CreatePollInput = z
  .object({
    resultsVisibility: PollResultsVisibilityEnum.default('after_vote'),
    options: z.array(PollOptionLabelSchema).min(2, { message: 'Polls need at least two options' }).max(10, { message: 'Polls can have at most 10 options' }),
  })
  .superRefine((data, ctx) => {
    const normalized = data.options.map((option) => option.trim().toLowerCase())
    const unique = new Set(normalized)
    if (unique.size !== normalized.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Poll options must be unique',
        path: ['options'],
      })
    }
  })
export type CreatePollInput = z.infer<typeof CreatePollInput>

export const CreatePostInput = z
  .object({
    type: PostTypeEnum.default('post'),
    businessId: z.string().cuid().optional(),
    showBusinessAuthor: z.boolean().optional(),
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
    hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_-]{1,50}$/)).max(10).optional(),
    communityProvince: z.string().trim().min(2).max(32).optional(),
    communitySlug: z.string().trim().min(1).max(160).optional(),
    jurisdiction: JurisdictionEnum.optional(),
    sharedPostId: z.string().cuid().optional(),
    poll: CreatePollInput.optional(),
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
    } else if (data.type === 'poll') {
      if (!data.poll) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Poll configuration is required',
          path: ['poll'],
        })
      }
      if (data.title) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Poll posts do not use article titles',
          path: ['title'],
        })
      }
      if (data.sharedPostId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Poll posts cannot share another post',
          path: ['sharedPostId'],
        })
      }
      const bodyLength = (data.body ?? '').trim().length
      if (bodyLength < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Polls need a question',
          path: ['body'],
        })
      }
      if (bodyLength > 5000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Poll questions must be 5000 characters or less',
          path: ['body'],
        })
      }
    } else {
      const bodyLength = (data.body ?? '').length
      const hasImages = Boolean(data.mediaUrl || (data.images && data.images.length > 0))
      const isSharedPost = typeof data.sharedPostId === 'string' && data.sharedPostId.trim().length > 0
      if (!isSharedPost && !hasImages && bodyLength < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Posts must include text or images',
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

export const VotePollInput = z.object({
  optionId: z.string().cuid(),
})
export type VotePollInput = z.infer<typeof VotePollInput>

export const AddPollOptionInput = z.object({
  label: PollOptionLabelSchema,
})
export type AddPollOptionInput = z.infer<typeof AddPollOptionInput>

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

const GeoJsonPolygonLikeSchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.any()),
})

export const ElectoralDistrictContextInput = z
  .object({
    postalCode: z.string().trim().min(3).max(12).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    const hasPostal = Boolean(value.postalCode?.trim())
    const hasLat = typeof value.lat === 'number'
    const hasLng = typeof value.lng === 'number'

    if (!hasPostal && !(hasLat && hasLng)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'postal_or_coordinates_required',
        path: ['postalCode'],
      })
    }

    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lat_lng_required_together',
        path: hasLat ? ['lng'] : ['lat'],
      })
    }
  })
export type ElectoralDistrictContextInput = z.infer<typeof ElectoralDistrictContextInput>

export const ElectoralDistrictContextResponseSchema = z.object({
  resolvedFrom: z.enum(['coordinates', 'postal_code']),
  postalCode: z.string().nullable(),
  tileServerBaseUrl: z.string(),
  styleUrl: z.string(),
  userLocation: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  district: z
    .object({
      code: z.number().int(),
      slug: z.string(),
      name: z.string(),
      provinceCode: z.string(),
      center: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      geometry: GeoJsonPolygonLikeSchema,
      matchMethod: z.enum(['contains', 'nearest']),
    })
    .nullable(),
})
export type ElectoralDistrictContextResponse = z.infer<typeof ElectoralDistrictContextResponseSchema>

export const ElectoralDistrictBrowserInput = z
  .object({
    provinceCode: z.string().trim().min(2).max(2).optional(),
    communitySlug: z.string().trim().min(1).max(160).optional(),
    postalCode: z.string().trim().min(3).max(12).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(24).default(12).optional(),
  })
  .superRefine((value, ctx) => {
    const hasProvince = Boolean(value.provinceCode?.trim())
    const hasCommunitySlug = Boolean(value.communitySlug?.trim())
    const hasPostal = Boolean(value.postalCode?.trim())
    const hasLat = typeof value.lat === 'number'
    const hasLng = typeof value.lng === 'number'

    if (!hasProvince && !hasPostal && !(hasLat && hasLng)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'province_or_location_required',
        path: ['provinceCode'],
      })
    }

    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lat_lng_required_together',
        path: hasLat ? ['lng'] : ['lat'],
      })
    }

    if (hasCommunitySlug && !hasProvince) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'province_required_for_community',
        path: ['communitySlug'],
      })
    }
  })
export type ElectoralDistrictBrowserInput = z.infer<typeof ElectoralDistrictBrowserInput>

export const ElectoralDistrictBrowserDistrictSchema = z.object({
  code: z.number().int(),
  slug: z.string(),
  name: z.string(),
  provinceCode: z.string(),
  party: z
    .object({
      slug: z.string(),
      name: z.string(),
      shortName: z.string().nullable(),
    })
    .nullable(),
  partyStatus: z.enum(['seat', 'registered']).nullable(),
  activeSeat: z
    .object({
      title: z.string(),
      party: z
        .object({
          slug: z.string(),
          name: z.string(),
          shortName: z.string().nullable(),
        })
        .nullable(),
      politician: z
        .object({
          slug: z.string(),
          displayName: z.string(),
          photoUrl: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  selectedPartyPolitician: z
    .object({
      slug: z.string().nullable(),
      displayName: z.string(),
      photoUrl: z.string().nullable(),
      roleLabel: z.string().nullable(),
    })
    .nullable(),
  center: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  geometry: GeoJsonPolygonLikeSchema,
  matchMethod: z.enum(['contains', 'nearest']).nullable(),
  postsToday: z.number().int().nonnegative(),
  followerCount: z.number().int().nonnegative(),
})
export type ElectoralDistrictBrowserDistrict = z.infer<typeof ElectoralDistrictBrowserDistrictSchema>

export const ElectoralDistrictBrowserResponseSchema = z.object({
  provinceCode: z.string(),
  resolvedFrom: z.enum(['coordinates', 'postal_code']).nullable(),
  postalCode: z.string().nullable(),
  tileServerBaseUrl: z.string(),
  styleUrl: z.string(),
  userLocation: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  selectedDistrictCode: z.number().int().nullable(),
  districts: z.array(ElectoralDistrictBrowserDistrictSchema),
})
export type ElectoralDistrictBrowserResponse = z.infer<typeof ElectoralDistrictBrowserResponseSchema>

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
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  countryOfBirth: z.string().trim().min(1).max(120).optional(),
  shareDateOfBirth: z.boolean().optional(),
  shareCountryOfBirth: z.boolean().optional(),
  bio: z
    .string()
    .max(20000, { message: 'Bio must be 20,000 characters or fewer' })
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

export const EnableFamilyModeInput = z.object({
  affirmedProfileTruth: z.literal(true),
  acceptedChildSafetyInfo: z.literal(true),
})
export type EnableFamilyModeInput = z.infer<typeof EnableFamilyModeInput>

const FamilyMemberNameSchema = z.string().trim().min(1).max(40)

export const FamilyRelationshipEnum = z.enum([
  'son',
  'daughter',
  'child',
  'stepson',
  'stepdaughter',
  'foster_child',
  'ward',
  'other',
])
export type FamilyRelationship = z.infer<typeof FamilyRelationshipEnum>

export const FamilyMemberInput = z.object({
  firstName: FamilyMemberNameSchema,
  lastName: FamilyMemberNameSchema,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  relationship: FamilyRelationshipEnum,
  allowChildOwnMediaEdits: z.boolean().optional().default(false),
  allowChildOwnUsernameEdits: z.boolean().optional().default(true),
  allowChildAudioCalls: z.boolean().optional().default(true),
  allowChildVideoCalls: z.boolean().optional().default(true),
  notifyParentOnMediaChanges: z.boolean().optional().default(false),
})
export type FamilyMemberInput = z.infer<typeof FamilyMemberInput>

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

export const ResolveGroupThreadInput = z.object({
  participantIds: z
    .array(z.string().cuid().or(z.string().uuid()))
    .min(1)
    .max(19),
})
export type ResolveGroupThreadInput = z.infer<typeof ResolveGroupThreadInput>

export const MessageCallInviteMetaInput = z
  .object({
    contextLabel: z.string().trim().max(80).nullable().optional(),
    imageUrl: z.string().trim().url().max(2048).nullable().optional(),
    imageAlt: z.string().trim().max(140).nullable().optional(),
    imageLabel: z.string().trim().max(120).nullable().optional(),
  })
  .strict()
export type MessageCallInviteMetaInput = z.infer<typeof MessageCallInviteMetaInput>

export const StartMessageCallInput = z.object({
  mode: z.enum(['audio', 'video']),
  inviteMeta: MessageCallInviteMetaInput.nullable().optional(),
})
export type StartMessageCallInput = z.infer<typeof StartMessageCallInput>

export const MessageCallRtcSessionInput = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  deviceId: z.string().trim().max(160).nullable().optional(),
  capabilities: z
    .object({
      audio: z.boolean().optional(),
      video: z.boolean().optional(),
    })
    .nullable()
    .optional(),
})
export type MessageCallRtcSessionInput = z.infer<typeof MessageCallRtcSessionInput>

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
  hashtags: z.array(z.string().regex(/^#[A-Za-z0-9_-]{1,50}$/)).max(10).optional(),
  showBusinessAuthor: z.boolean().optional(),
})
