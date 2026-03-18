'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import DashboardShell from '../../_components/DashboardShell'
import { buildApiUrl } from '../../_lib/api'
import { RightRail } from '../../_components/RightRail'
import CivilCard from '../../_components/CivilCard'

type OrgDirectoryItem = {
  id: string
  name: string
  slug: string
  type:
    | 'INDIVIDUAL'
    | 'SOLE_PROPRIETORSHIP'
    | 'CORPORATION'
    | 'NON_PROFIT'
    | 'CHARITY'
    | 'COMMUNITY_GROUP'
    | 'RELIGIOUS_ORGANIZATION'
    | 'GOVERNMENT'
  category?: string | null
  specialization?: string | null
  provinceCode: string
  communitySlug: string
  isVerified: boolean
  logoUrl?: string | null
  coverUrl?: string | null
  phone?: string | null
  websiteUrl?: string | null
  address?: string | null
  schedule?: string | null
}

type DirectoryResponse = {
  items?: OrgDirectoryItem[]
}

const TYPE_OPTIONS: Array<{ value: '' | OrgDirectoryItem['type']; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'CORPORATION', label: 'Corporation' },
  { value: 'NON_PROFIT', label: 'Non Profit' },
  { value: 'CHARITY', label: 'Charity' },
  { value: 'COMMUNITY_GROUP', label: 'Community Group' },
  { value: 'RELIGIOUS_ORGANIZATION', label: 'Religious Organization' },
  { value: 'GOVERNMENT', label: 'Government' },
]

const CATEGORY_SPECIALIZATION_OPTIONS = {
  TRADES: ['ELECTRICIAN', 'PLUMBER', 'CARPENTER', 'HVAC_TECHNICIAN', 'ROOFER', 'PAINTER', 'DRYWALL_INSTALLER', 'FLOORING_INSTALLER', 'WELDER', 'GENERAL_CONTRACTOR', 'HANDYMAN', 'APPLIANCE_REPAIR_TECHNICIAN', 'ELEVATOR_TECHNICIAN', 'MASONRY_BRICKLAYER'],
  CONSTRUCTION_RENOVATION: ['HOME_BUILDER', 'RENOVATION_SPECIALIST', 'DEMOLITION', 'FRAMING', 'CONCRETE_WORK', 'EXCAVATION', 'LANDSCAPING', 'FENCE_DECK_BUILDER', 'POOL_INSTALLATION', 'CABINET_MAKER'],
  AUTOMOTIVE_MECHANICAL: ['AUTO_REPAIR_MECHANIC', 'MOBILE_MECHANIC', 'AUTO_BODY_REPAIR', 'TIRE_SERVICES', 'OIL_CHANGE_SERVICES', 'CAR_DETAILING', 'VEHICLE_INSPECTION', 'SMALL_ENGINE_REPAIR', 'DIESEL_MECHANIC'],
  TRANSPORTATION_DELIVERY: ['COURIER_DELIVERY_DRIVER', 'MOVING_SERVICES', 'TRUCKING_FREIGHT', 'RIDESHARE_DRIVER', 'PERSONAL_DRIVER_CHAUFFEUR', 'LOGISTICS_COORDINATION', 'TOWING_SERVICES'],
  FOOD_CATERING: ['CATERING_SERVICES', 'PRIVATE_CHEF', 'MEAL_PREP_SERVICES', 'BAKERY', 'FOOD_TRUCK', 'RESTAURANT', 'BUTCHER', 'MEAL_DELIVERY', 'FARMERS_MARKET_VENDOR'],
  AGRICULTURE_FARMING: ['VEGETABLE_FARMING', 'FRUIT_FARMING', 'LIVESTOCK_FARMING', 'DAIRY_PRODUCTION', 'POULTRY_FARMING', 'GREENHOUSE_PRODUCTION', 'BEEKEEPING', 'AQUACULTURE', 'ORGANIC_FARMING'],
  RETAIL_ECOMMERCE: ['GENERAL_RETAIL', 'ONLINE_STORE', 'WHOLESALE_DISTRIBUTOR', 'DROPSHIPPING', 'SPECIALTY_SHOP', 'CONVENIENCE_STORE', 'MARKET_VENDOR'],
  HEALTH_BEAUTY: ['MASSAGE_THERAPIST', 'HAIR_STYLIST', 'BARBER', 'ESTHETICIAN', 'NAIL_TECHNICIAN', 'MAKEUP_ARTIST', 'SPA_SERVICES', 'TATTOO_ARTIST', 'PIERCING_SERVICES'],
  HEALTHCARE: ['NURSE', 'PERSONAL_SUPPORT_WORKER', 'PHYSIOTHERAPIST', 'CHIROPRACTOR', 'OCCUPATIONAL_THERAPIST', 'MENTAL_HEALTH_COUNSELOR', 'HOME_CARE_PROVIDER', 'MEDICAL_CLINIC'],
  FITNESS_SPORTS: ['PERSONAL_TRAINER', 'FITNESS_COACH', 'YOGA_INSTRUCTOR', 'MARTIAL_ARTS_INSTRUCTOR', 'SPORTS_COACH', 'GYM_FITNESS_FACILITY'],
  EDUCATION_TUTORING: ['TUTOR', 'LANGUAGE_INSTRUCTOR', 'MUSIC_TEACHER', 'DRIVING_INSTRUCTOR', 'EDUCATIONAL_CONSULTANT', 'PRIVATE_SCHOOL', 'ONLINE_COURSE_PROVIDER'],
  CHILDCARE_FAMILY: ['BABYSITTER', 'NANNY', 'DAYCARE_PROVIDER', 'FAMILY_SUPPORT_SERVICES', 'ELDER_CARE'],
  CLEANING_MAINTENANCE: ['RESIDENTIAL_CLEANING', 'COMMERCIAL_CLEANING', 'WINDOW_CLEANING', 'CARPET_CLEANING', 'PRESSURE_WASHING', 'JANITORIAL_SERVICES', 'PROPERTY_MAINTENANCE'],
  PROFESSIONAL_SERVICES: ['ACCOUNTANT', 'BOOKKEEPER', 'LAWYER', 'PARALEGAL', 'CONSULTANT', 'BUSINESS_ADVISOR', 'INSURANCE_AGENT', 'FINANCIAL_ADVISOR'],
  TECHNOLOGY_IT: ['SOFTWARE_DEVELOPER', 'WEB_DEVELOPER', 'MOBILE_APP_DEVELOPER', 'IT_SUPPORT', 'NETWORK_TECHNICIAN', 'CYBERSECURITY_SPECIALIST', 'AI_DEVELOPER', 'DATA_ANALYST'],
  MEDIA_CREATIVE: ['GRAPHIC_DESIGNER', 'WEB_DESIGNER', 'PHOTOGRAPHER', 'VIDEOGRAPHER', 'VIDEO_EDITOR', 'ANIMATOR', 'CONTENT_CREATOR', 'COPYWRITER'],
  MARKETING_SALES: ['DIGITAL_MARKETING', 'SEO_SPECIALIST', 'SOCIAL_MEDIA_MANAGER', 'ADVERTISING_SPECIALIST', 'SALES_REPRESENTATIVE', 'LEAD_GENERATION'],
  EVENTS_ENTERTAINMENT: ['EVENT_PLANNER', 'DJ', 'MUSICIAN', 'ENTERTAINER', 'WEDDING_SERVICES', 'PARTY_RENTALS'],
  REAL_ESTATE_PROPERTY: ['REAL_ESTATE_AGENT', 'PROPERTY_MANAGER', 'HOME_INSPECTOR', 'MORTGAGE_BROKER', 'APPRAISER'],
  TRAVEL_HOSPITALITY: ['TRAVEL_AGENT', 'TOUR_GUIDE', 'HOTEL_ACCOMMODATION', 'SHORT_TERM_RENTAL_HOST'],
  SECURITY_SAFETY: ['SECURITY_GUARD', 'PRIVATE_INVESTIGATOR', 'ALARM_SYSTEMS', 'FIRE_SAFETY_SERVICES'],
  GOVERNMENT_PUBLIC_SERVICES: ['MUNICIPAL_SERVICES', 'PROVINCIAL_SERVICES', 'FEDERAL_SERVICES', 'PUBLIC_ADMINISTRATION'],
  NON_PROFIT_COMMUNITY: ['COMMUNITY_ORGANIZATION', 'ADVOCACY_GROUP', 'VOLUNTEER_ORGANIZATION', 'FOOD_BANK', 'SHELTER_SERVICES'],
  RELIGIOUS: ['CHURCH', 'MOSQUE', 'TEMPLE', 'SYNAGOGUE', 'FAITH_BASED_SERVICES'],
  ARTS_CULTURE: ['ARTIST', 'GALLERY', 'CULTURAL_ORGANIZATION', 'MUSEUM', 'THEATER'],
  MANUFACTURING_INDUSTRIAL: ['FABRICATION', 'ASSEMBLY', 'PACKAGING', 'CNC_MACHINING', 'THREE_D_PRINTING', 'TEXTILE_PRODUCTION'],
  OTHER: ['OTHER_SERVICES', 'MISCELLANEOUS'],
} as const

type OrganizationCategoryValue = keyof typeof CATEGORY_SPECIALIZATION_OPTIONS
type OrganizationSpecializationValue = (typeof CATEGORY_SPECIALIZATION_OPTIONS)[OrganizationCategoryValue][number]

const CATEGORY_OPTIONS = Object.keys(CATEGORY_SPECIALIZATION_OPTIONS) as OrganizationCategoryValue[]

function formatTypeLabel(value: OrgDirectoryItem['type']) {
  return TYPE_OPTIONS.find((opt) => opt.value === value)?.label ?? value
}

function formatDirectoryLabel(value: string | null | undefined) {
  if (!value) return null
  return value
    .split('_')
    .map((segment) => (segment ? segment[0] + segment.slice(1).toLowerCase() : segment))
    .join(' ')
}

function toWebsiteHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

export default function OrganizationDirectoryPageClient() {
  const searchParams = useSearchParams()
  const searchParamQuery = searchParams.get('q')?.trim() ?? ''
  const searchParamCategory = searchParams.get('category')?.trim() ?? ''
  const searchParamSpecialization = searchParams.get('specialization')?.trim() ?? ''
  const [q, setQ] = useState(searchParamQuery)
  const [category, setCategory] = useState<'' | OrganizationCategoryValue>(
    CATEGORY_OPTIONS.includes(searchParamCategory as OrganizationCategoryValue) ? (searchParamCategory as OrganizationCategoryValue) : '',
  )
  const [specialization, setSpecialization] = useState<'' | OrganizationSpecializationValue>('')
  const [items, setItems] = useState<OrgDirectoryItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    params.set('limit', '50')
    return buildApiUrl(`/organizations/directory?${params.toString()}`)
  }, [q])

  const specializationOptions = useMemo(() => {
    return category ? CATEGORY_SPECIALIZATION_OPTIONS[category] : []
  }, [category])

  useEffect(() => {
    setQ(searchParamQuery)
    const nextCategory = CATEGORY_OPTIONS.includes(searchParamCategory as OrganizationCategoryValue)
      ? (searchParamCategory as OrganizationCategoryValue)
      : ''
    setCategory(nextCategory)

    if (nextCategory) {
      const allowed = CATEGORY_SPECIALIZATION_OPTIONS[nextCategory] as readonly string[]
      setSpecialization(allowed.includes(searchParamSpecialization) ? (searchParamSpecialization as OrganizationSpecializationValue) : '')
      return
    }

    setSpecialization('')
  }, [searchParamCategory, searchParamQuery, searchParamSpecialization])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (category && item.category !== category) return false
      if (specialization && item.specialization !== specialization) return false
      return true
    })
  }, [category, items, specialization])

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    try {
      const res = await fetch(apiUrl, { cache: 'no-store' })
      const payload = (await res.json().catch(() => null)) as (DirectoryResponse & { error?: unknown; message?: unknown }) | null
      if (!res.ok) {
        const errorCode = typeof payload?.error === 'string' ? payload.error : null
        const message = typeof payload?.message === 'string' ? payload.message : null
        setErrorMessage(
          message
            ? message
            : errorCode
              ? `Request failed (${res.status} ${errorCode}).`
              : `Request failed (${res.status}).`,
        )
        throw new Error('request_failed')
      }
      setItems(Array.isArray(payload?.items) ? payload!.items! : [])
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [apiUrl])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <DashboardShell
      rightRail={<RightRail mode="organizationsDirectory" />}
      mainClassName="space-y-6"
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Organizations Directory</h1>
        <p className="text-sm text-slate-600">Search and browse organizations by category and specialization.</p>
      </div>

      <div className="space-y-3">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            placeholder="Search by name"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Category
            <select
              value={category}
              onChange={(e) => {
                const nextCategory = e.target.value as '' | OrganizationCategoryValue
                setCategory(nextCategory)
                if (!nextCategory) {
                  setSpecialization('')
                  return
                }
                const nextOptions = CATEGORY_SPECIALIZATION_OPTIONS[nextCategory] as readonly string[]
                if (!nextOptions.includes(specialization)) {
                  setSpecialization('')
                }
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none"
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {formatDirectoryLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Specialization
            <select
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value as '' | OrganizationSpecializationValue)}
              disabled={!category}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[var(--cc-primary)] focus:outline-none disabled:opacity-60"
            >
              <option value="">{category ? 'All specializations' : 'Select a category first'}</option>
              {specializationOptions.map((option) => (
                <option key={option} value={option}>
                  {formatDirectoryLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="surface-card p-5">
        {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {status === 'error' ? (
          <p className="text-sm text-slate-500">{errorMessage ?? 'Unable to load directory.'}</p>
        ) : null}
        {status === 'ready' && !filteredItems.length ? <p className="text-sm text-slate-500">No organizations found.</p> : null}

        {filteredItems.length ? (
          <ul className="space-y-3">
            {filteredItems.map((org) => (
              <li key={org.id}>
                <CivilCard
                  size="lg"
                  name={org.name}
                  avatarAlt={org.name}
                  avatarInitials={org.name}
                  avatarSrc={org.logoUrl ?? null}
                  avatarHref={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  titleHref={`/com/${org.provinceCode.toLowerCase()}/${org.communitySlug.toLowerCase()}/orgs/${org.slug}`}
                  coverUrl={org.coverUrl ?? null}
                  subtitle={[
                    formatTypeLabel(org.type),
                    formatDirectoryLabel(org.category),
                    formatDirectoryLabel(org.specialization),
                    org.provinceCode.toUpperCase(),
                    org.communitySlug,
                  ].filter(Boolean).join(' · ')}
                  details={
                    <div className="space-y-1">
                      {org.phone ? <p className="truncate">{org.phone}</p> : null}
                      {org.websiteUrl ? (
                        <p className="truncate">
                          <a
                            href={toWebsiteHref(org.websiteUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {org.websiteUrl}
                          </a>
                        </p>
                      ) : null}
                      {org.address ? <p className="truncate">{org.address}</p> : null}
                      {org.schedule ? <p className="truncate">{org.schedule}</p> : null}
                    </div>
                  }
                  isVerified={org.isVerified}
                  trailing={
                    org.isVerified ? (
                      <span className="shrink-0 rounded-full border border-white/40 bg-white/10 px-2 py-1 text-xs font-semibold text-white">Verified</span>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DashboardShell>
  )
}
