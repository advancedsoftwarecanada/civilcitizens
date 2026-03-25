import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Queue } from 'bullmq'
import { prisma } from '@civil/db'
import {
  PoliticalJurisdiction,
  PoliticalOfficeType,
  PoliticianScrapeJobSource,
  PoliticianScrapeJobStatus,
  Prisma,
} from '@prisma/client'
import { XMLParser } from 'fast-xml-parser'
import { COMMUNITIES, PROVINCES, findCommunity, normalizeProvinceCode, slugifyCommunityName } from '@civil/shared'
import { z } from 'zod'
import { browseFederalPartyDistricts, resolveCommunityElectoralDistrictContext } from '../geospatial.js'

type CommunityLookupRecord = (typeof COMMUNITIES)[number]

const ADMIN_EDA_IMPORT_BODY = z.object({
  sourceKey: z.string().trim().min(1).max(120),
})

const COMMUNITY_POLITICIANS_PARAMS = z.object({
  province: z.string().trim().min(2).max(40),
  municipality: z.string().trim().min(1).max(120),
})

const FEDERAL_PARTY_QUERY = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const FEDERAL_PARTY_PARAMS = z.object({
  partySlug: z.string().trim().min(1).max(120),
})

const FEDERAL_PARTY_DISTRICTS_QUERY = z.object({
  provinceCode: z.string().trim().max(40).optional(),
})

const FEDERAL_MEMBER_PARAMS = z.object({
  partySlug: z.string().trim().min(1).max(120),
  memberSlug: z.string().trim().min(1).max(120),
})

const FEDERAL_DATASET_SOURCES = [
  {
    key: 'federal-members-all-2025-03-15',
    label: 'Elections Canada federal associations (2025-03-15)',
    filename: 'federal_members_all_2025_03_15.csv',
    jurisdiction: PoliticalJurisdiction.FEDERAL,
    officeType: PoliticalOfficeType.MP,
  },
] as const

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

const PARTY_SHORT_NAME_OVERRIDES: Record<string, string> = {
  'conservative-party-of-canada': 'Conservative',
  'liberal-party-of-canada': 'Liberal',
  'new-democratic-party': 'NDP',
  'green-party-of-canada': 'Green',
  'bloc-quebecois': 'Bloc Quebecois',
  'peoples-party-of-canada': "People's Party",
}

type AdminUser = { id: string; email: string | null }

type PoliticiansRouteDeps = {
  loadAdminUserOrReply: (req: FastifyRequest, reply: FastifyReply) => Promise<AdminUser | null>
  politicianScrapeQueue: Queue<{ scrapeJobId: string }>
}

type FederalDatasetSource = (typeof FEDERAL_DATASET_SOURCES)[number]

type FederalAssociationCsvRow = {
  Registered_association: string
  Registration_status: string
  Headquarters_city: string
  Headquarters_province: string
  Headquarters_postal_code: string
  Headquarters_telephone: string
  Headquarters_fax: string
  Headquarters_email: string
  Headquarters_website: string
  Political_party: string
  Electoral_district: string
  Registered_date: string
  Deregistered_date: string
  Move_house_type: string
  Previous_redistribution_year: string
  Next_redistribution_year: string
  Next_electoral_disctrict: string
  Next_registered_association: string
  CEO_name: string
  Financial_agent_name: string
  Financial_agent_city: string
  Financial_agent_province: string
  Financial_agent_postal_code: string
  Auditor_name: string
  Auditor_city: string
  Auditor_province: string
  Auditor_postal_code: string
  Deregistered_sections: string
}

type NormalizedFederalAssociationRow = {
  associationName: string
  registrationStatus: string | null
  partyName: string
  partySlug: string
  partyShortName: string
  districtName: string
  provinceCode: string
  communitySlug: string
  electoralDistrictCode: number | null
  sourceRecordKey: string
  registeredAt: Date | null
  deregisteredAt: Date | null
  metadata: Prisma.InputJsonValue
}

type ScrapeJobBucketStat = {
  count: number
  queued: number
  processing: number
  completed: number
  failed: number
  lastUpdatedAt: string | null
}

type CommonsCoverageStatus = 'up_to_date' | 'in_progress' | 'attention' | 'needs_refresh'

type CommonsCoverageStat = {
  currentMembers: number
  occupiedSeats: number
  vacantSeats: number
  politiciansWithProfileUrl: number
  xmlSynced: number
  htmlSynced: number
  photos: number
  emails: number
  websites: number
  hillOffices: number
  constituencyOffices: number
  remainingXmlSync: number
  remainingHtmlSync: number
  lastXmlSyncAt: string | null
  lastHtmlSyncAt: string | null
  status: CommonsCoverageStatus
}

type PoliticalDatasetStats = {
  parties: { count: number; lastUpdatedAt: string | null }
  associations: { count: number; lastUpdatedAt: string | null }
  seats: { count: number; occupied: number; vacant: number; lastUpdatedAt: string | null }
  politicians: { count: number; lastUpdatedAt: string | null }
  scrapeJobs: ScrapeJobBucketStat & {
    xml: ScrapeJobBucketStat
    html: ScrapeJobBucketStat
  }
  commonsCoverage: CommonsCoverageStat
}

type FederalMemberImportSummary = {
  importedAt: string
  provincesProcessed: number
  membersProcessed: number
  unresolvedMembers: number
  unresolvedSample: Array<{ personId: string; constituencyName: string; reason: string }>
  partiesCreated: number
  partiesUpdated: number
  politiciansCreated: number
  politiciansUpdated: number
  seatsCreated: number
  seatsUpdated: number
  scrapeJobsCreated: number
  scrapeJobsRequeued: number
}

type FederalMemberDetailFetchSummary = {
  enqueuedAt: string
  politiciansConsidered: number
  jobsCreated: number
  jobsRequeued: number
  jobsAlreadyQueued: number
  skippedMissingProfileUrl: number
}

type OurCommonsOfficeSummary = {
  label: string | null
  lines: string[]
  telephone: string | null
  fax: string | null
}

type OurCommonsProfileSummary = {
  profileUrl: string | null
  xmlUrl: string | null
  photoUrl: string | null
  lastXmlSyncAt: string | null
  lastHtmlSyncAt: string | null
  contact: {
    email: string | null
    website: string | null
    hillOffice: OurCommonsOfficeSummary | null
    constituencyOffices: OurCommonsOfficeSummary[]
  }
}

type OurCommonsMemberSummary = {
  personId: string
  firstName: string
  lastName: string
  displayName: string
  constituencyName: string
  provinceCode: string
  provinceName: string
  caucusShortName: string | null
  fromDateTime: string | null
  toDateTime: string | null
  profileUrl: string
  xmlUrl: string
}

const OUR_COMMONS_BASE_URL = 'https://www.ourcommons.ca'
const OUR_COMMONS_PROVINCE_CODES = PROVINCES.map((entry: (typeof PROVINCES)[number]) => entry.code.toUpperCase())
const OUR_COMMONS_MEMBER_XML_TIMEOUT_MS = 20_000
const OUR_COMMONS_XML_PARSER = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
})

const FEDERAL_COMMONS_PARTY_SLUG_OVERRIDES: Record<string, string> = {
  liberal: 'liberal-party-of-canada',
  conservative: 'conservative-party-of-canada',
  ndp: 'new-democratic-party',
  green: 'green-party-of-canada',
  'green-party': 'green-party-of-canada',
  'bloc-quebecois': 'bloc-quebecois',
  independent: 'independent',
}

function buildEmptyPoliticalDatasetStats(): PoliticalDatasetStats {
  return {
    parties: { count: 0, lastUpdatedAt: null },
    associations: { count: 0, lastUpdatedAt: null },
    seats: { count: 0, occupied: 0, vacant: 0, lastUpdatedAt: null },
    politicians: { count: 0, lastUpdatedAt: null },
    scrapeJobs: {
      count: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      lastUpdatedAt: null,
      xml: {
        count: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        lastUpdatedAt: null,
      },
      html: {
        count: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        lastUpdatedAt: null,
      },
    },
    commonsCoverage: {
      currentMembers: 0,
      occupiedSeats: 0,
      vacantSeats: 0,
      politiciansWithProfileUrl: 0,
      xmlSynced: 0,
      htmlSynced: 0,
      photos: 0,
      emails: 0,
      websites: 0,
      hillOffices: 0,
      constituencyOffices: 0,
      remainingXmlSync: 0,
      remainingHtmlSync: 0,
      lastXmlSyncAt: null,
      lastHtmlSyncAt: null,
      status: 'needs_refresh',
    },
  }
}

function isPoliticalStorageUnavailableError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021' || error.code === 'P2022'
  }

  if (error && typeof error === 'object') {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    return /PoliticalParty|PoliticalDistrictAssociation|PoliticalSeat|Politician|PoliticianScrapeJob|does not exist|doesn't exist|relation .* does not exist/i.test(message)
  }

  return false
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\uFEFF/g, '').trim()
}

function buildPartyShortName(name: string, slug: string) {
  const override = PARTY_SHORT_NAME_OVERRIDES[slug]
  if (override) return override

  return name
    .replace(/ party of canada$/i, '')
    .replace(/^the\s+/i, '')
    .replace(/ federal$/i, '')
    .trim() || name
}

function parseElectionsCanadaDate(value: string): Date | null {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(trimmed)
  if (!match) return null

  const day = Number(match[1])
  const monthKey = match[2]?.toLowerCase()
  const month = monthKey ? MONTH_INDEX[monthKey] : undefined
  const rawYear = Number(match[3])
  if (!Number.isInteger(day) || month === undefined || !Number.isInteger(rawYear)) return null

  const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear
  const parsed = new Date(Date.UTC(year, month, day))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function parseCsv(raw: string): FederalAssociationCsvRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)

  const headerLine = lines[0]
  if (!headerLine) return []

  const headers = parseCsvLine(headerLine).map((header) => normalizeText(header))
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = normalizeText(cells[index] ?? '')
    })
    return row as FederalAssociationCsvRow
  })
}

function normalizeDistrictLookupKey(value: string) {
  return value
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFKD')
    .replace(/—|–/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value == null ? [] : [value]
}

function readXmlText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['@_xsi:nil'] === 'true') return null
  const text = record['#text']
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

function parseIsoDateTime(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function buildPoliticianSlug(displayName: string, personId: string) {
  return `${slugifyCommunityName(displayName)}-${personId}`
}

function canonicalizeCommonsPartySlug(value: string | null) {
  const base = slugifyCommunityName(value ?? '')
  if (!base) return null
  return FEDERAL_COMMONS_PARTY_SLUG_OVERRIDES[base] ?? base
}

function buildOurCommonsProfileUrl(firstName: string, lastName: string, personId: string) {
  const nameSlug = slugifyCommunityName(`${firstName} ${lastName}`)
  return `${OUR_COMMONS_BASE_URL}/Members/en/${nameSlug}(${encodeURIComponent(personId)})`
}

async function fetchXmlDocument(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OUR_COMMONS_MEMBER_XML_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/xml,text/xml' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`commons_fetch_failed:${response.status}`)
    }

    const raw = await response.text()
    return OUR_COMMONS_XML_PARSER.parse(raw) as Record<string, unknown>
  } finally {
    clearTimeout(timeout)
  }
}

function parseOurCommonsMemberFeed(doc: Record<string, unknown>, fallbackProvinceCode: string): OurCommonsMemberSummary[] {
  const root = doc.ArrayOfMemberOfParliament as Record<string, unknown> | undefined
  const rows = toArray(root?.MemberOfParliament as Record<string, unknown> | Array<Record<string, unknown>> | undefined)

  return rows
    .map((entry) => {
      const personId = readXmlText(entry.PersonId)
      const firstName = readXmlText(entry.PersonOfficialFirstName)
      const lastName = readXmlText(entry.PersonOfficialLastName)
      const constituencyName = readXmlText(entry.ConstituencyName)
      const provinceName = readXmlText(entry.ConstituencyProvinceTerritoryName)
      if (!personId || !firstName || !lastName || !constituencyName) return null

      const provinceCode = normalizeProvinceCode(provinceName) ?? fallbackProvinceCode
      if (!provinceCode) return null

      const profileUrl = buildOurCommonsProfileUrl(firstName, lastName, personId)
      return {
        personId,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        constituencyName,
        provinceCode,
        provinceName: provinceName ?? fallbackProvinceCode.toUpperCase(),
        caucusShortName: readXmlText(entry.CaucusShortName),
        fromDateTime: readXmlText(entry.FromDateTime),
        toDateTime: readXmlText(entry.ToDateTime),
        profileUrl,
        xmlUrl: `${profileUrl}/xml`,
      } satisfies OurCommonsMemberSummary
    })
    .filter((entry): entry is OurCommonsMemberSummary => entry !== null)
}

async function resolveFederalParty(
  tx: Prisma.TransactionClient,
  caucusShortName: string | null,
  importedAt: string,
) {
  const normalizedName = caucusShortName?.trim() || 'Independent'
  const canonicalSlug = canonicalizeCommonsPartySlug(normalizedName) ?? 'independent'
  const existing =
    (await tx.politicalParty.findUnique({
      where: {
        jurisdiction_slug: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          slug: canonicalSlug,
        },
      },
      select: { id: true, slug: true },
    })) ??
    (await tx.politicalParty.findFirst({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        OR: [{ shortName: { equals: normalizedName, mode: 'insensitive' } }, { name: { equals: normalizedName, mode: 'insensitive' } }],
      },
      select: { id: true, slug: true },
    }))

  const party = await tx.politicalParty.upsert({
    where: {
      jurisdiction_slug: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        slug: existing?.slug ?? canonicalSlug,
      },
    },
    create: {
      jurisdiction: PoliticalJurisdiction.FEDERAL,
      slug: existing?.slug ?? canonicalSlug,
      name: normalizedName,
      shortName: normalizedName,
      metadata: {
        source: {
          lastImportAt: importedAt,
          source: 'ourcommons',
        },
      },
    },
    update: {
      shortName: normalizedName,
      metadata: {
        source: {
          lastImportAt: importedAt,
          source: 'ourcommons',
        },
      },
    },
    select: { id: true, slug: true },
  })

  return { party, created: !existing }
}

function readStringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function extractOurCommonsProfileResult(profile: Record<string, unknown>) {
  const memberRole = readStringRecord(profile.MemberOfParliamentRole)
  const caucusRolesContainer = readStringRecord(profile.CaucusMemberRoles)
  const committeeRolesContainer = readStringRecord(profile.CommitteeMemberRoles)
  const associationRolesContainer = readStringRecord(profile.ParliamentaryAssociationsandInterparliamentaryGroupRoles)

  return {
    memberRole: memberRole
      ? {
          personId: readXmlText(memberRole.PersonId),
          constituencyName: readXmlText(memberRole.ConstituencyName),
          provinceName: readXmlText(memberRole.ConstituencyProvinceTerritoryName),
          caucusShortName: readXmlText(memberRole.CaucusShortName),
          fromDateTime: readXmlText(memberRole.FromDateTime),
          toDateTime: readXmlText(memberRole.ToDateTime),
        }
      : null,
    caucusRoles: toArray(caucusRolesContainer?.CaucusMemberRole).map((role) => {
      const record = readStringRecord(role)
      return {
        caucusShortName: readXmlText(record?.CaucusShortName),
        title: readXmlText(record?.Title),
        fromDateTime: readXmlText(record?.FromDateTime),
        toDateTime: readXmlText(record?.ToDateTime),
      }
    }),
    committeeRoles: toArray(committeeRolesContainer?.CommitteeMemberRole).map((role) => {
      const record = readStringRecord(role)
      return {
        organization: readXmlText(record?.Organization),
        title: readXmlText(record?.Title),
      }
    }),
    associationRoles: toArray(associationRolesContainer?.ParliamentaryAssociationsandInterparliamentaryGroupRole).map((role) => {
      const record = readStringRecord(role)
      return {
        organization: readXmlText(record?.Organization),
        title: readXmlText(record?.Title),
        roleType: readXmlText(record?.AssociationMemberRoleType),
      }
    }),
  }
}

async function resolveDatasetPath(filename: string) {
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/public/datasets', filename),
    path.resolve(process.cwd(), '../web/public/datasets', filename),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`dataset_not_found:${filename}`)
}

function createCommunityLookup() {
  const bySlug = new Map<string, CommunityLookupRecord[]>()
  const byDistrictKey = new Map<string, CommunityLookupRecord[]>()
  for (const community of COMMUNITIES) {
    const slugMatches = bySlug.get(community.slug)
    if (slugMatches) {
      slugMatches.push(community)
    } else {
      bySlug.set(community.slug, [community])
    }

    const districtKey = normalizeDistrictLookupKey(community.name)
    const districtMatches = byDistrictKey.get(districtKey)
    if (districtMatches) {
      districtMatches.push(community)
    } else {
      byDistrictKey.set(districtKey, [community])
    }
  }

  return { bySlug, byDistrictKey }
}

function pickCommunityFromDistrictName(args: {
  districtName: string
  headquartersProvince: string
  communityLookup: ReturnType<typeof createCommunityLookup>
}) {
  const districtSlug = slugifyCommunityName(args.districtName)
  const districtKey = normalizeDistrictLookupKey(args.districtName)
  const matches = args.communityLookup.bySlug.get(districtSlug) ?? args.communityLookup.byDistrictKey.get(districtKey) ?? []
  if (!matches.length) return null

  const preferredProvince = normalizeProvinceCode(args.headquartersProvince)
  if (preferredProvince) {
    const match = matches.find((entry) => entry.province === preferredProvince)
    if (match) return match
  }

  return matches.length === 1 ? matches[0] : null
}

function buildAssociationMetadata(row: FederalAssociationCsvRow, importedAt: string): Prisma.InputJsonValue {
  return {
    source: {
      importedAt,
      headquartersCity: normalizeText(row.Headquarters_city) || null,
      headquartersProvince: normalizeText(row.Headquarters_province) || null,
      headquartersPostalCode: normalizeText(row.Headquarters_postal_code) || null,
      headquartersTelephone: normalizeText(row.Headquarters_telephone) || null,
      headquartersFax: normalizeText(row.Headquarters_fax) || null,
      headquartersEmail: normalizeText(row.Headquarters_email) || null,
      headquartersWebsite: normalizeText(row.Headquarters_website) || null,
      moveHouseType: normalizeText(row.Move_house_type) || null,
      previousRedistributionYear: normalizeText(row.Previous_redistribution_year) || null,
      nextRedistributionYear: normalizeText(row.Next_redistribution_year) || null,
      nextElectoralDistrict: normalizeText(row.Next_electoral_disctrict) || null,
      nextRegisteredAssociation: normalizeText(row.Next_registered_association) || null,
      ceoName: normalizeText(row.CEO_name) || null,
      financialAgentName: normalizeText(row.Financial_agent_name) || null,
      financialAgentCity: normalizeText(row.Financial_agent_city) || null,
      financialAgentProvince: normalizeText(row.Financial_agent_province) || null,
      financialAgentPostalCode: normalizeText(row.Financial_agent_postal_code) || null,
      auditorName: normalizeText(row.Auditor_name) || null,
      auditorCity: normalizeText(row.Auditor_city) || null,
      auditorProvince: normalizeText(row.Auditor_province) || null,
      auditorPostalCode: normalizeText(row.Auditor_postal_code) || null,
      deregisteredSections: normalizeText(row.Deregistered_sections) || null,
    },
  }
}

async function loadNormalizedFederalRows(source: FederalDatasetSource) {
  const datasetPath = await resolveDatasetPath(source.filename)
  const raw = await fs.readFile(datasetPath, 'utf8')
  const rows = parseCsv(raw)
  const importedAt = new Date().toISOString()
  const communityLookup = createCommunityLookup()
  const districtRows = await prisma.electoralDistrict.findMany({
    select: { code: true, provinceCode: true, slug: true },
  })
  const districtCodeByKey = new Map<string, number>()
  for (const row of districtRows) {
    districtCodeByKey.set(`${row.provinceCode}:${row.slug}`, row.code)
  }

  const normalized: NormalizedFederalAssociationRow[] = []
  const unresolved: Array<{ districtName: string; associationName: string; reason: string }> = []

  for (const row of rows) {
    const associationName = normalizeText(row.Registered_association)
    const partyName = normalizeText(row.Political_party)
    const districtName = normalizeText(row.Electoral_district)
    if (!associationName || !partyName || !districtName) {
      unresolved.push({ districtName, associationName, reason: 'missing_required_fields' })
      continue
    }

    const community = pickCommunityFromDistrictName({
      districtName,
      headquartersProvince: row.Headquarters_province,
      communityLookup,
    })
    if (!community) {
      unresolved.push({ districtName, associationName, reason: 'district_not_mapped' })
      continue
    }

    const partySlug = slugifyCommunityName(partyName)
    const districtKey = `${community.province}:${community.slug}`
    normalized.push({
      associationName,
      registrationStatus: normalizeText(row.Registration_status) || null,
      partyName,
      partySlug,
      partyShortName: buildPartyShortName(partyName, partySlug),
      districtName,
      provinceCode: community.province,
      communitySlug: community.slug,
      electoralDistrictCode: districtCodeByKey.get(districtKey) ?? null,
      sourceRecordKey: `${source.key}:${community.province}:${community.slug}:${partySlug}`,
      registeredAt: parseElectionsCanadaDate(row.Registered_date),
      deregisteredAt: parseElectionsCanadaDate(row.Deregistered_date),
      metadata: buildAssociationMetadata(row, importedAt),
    })
  }

  return { datasetPath, normalized, unresolved }
}

async function importFederalAssociations(source: FederalDatasetSource) {
  const importedAt = new Date().toISOString()
  const { normalized, unresolved } = await loadNormalizedFederalRows(source)
  const partyIdBySlug = new Map<string, string>()
  let partiesCreated = 0
  let partiesUpdated = 0
  let associationsCreated = 0
  let associationsUpdated = 0
  let seatsCreated = 0
  let seatsUpdated = 0

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const row of normalized) {
      let partyId = partyIdBySlug.get(row.partySlug)
      if (!partyId) {
        const existingParty = await tx.politicalParty.findUnique({
          where: {
            jurisdiction_slug: {
              jurisdiction: source.jurisdiction,
              slug: row.partySlug,
            },
          },
          select: { id: true },
        })
        const party = await tx.politicalParty.upsert({
          where: {
            jurisdiction_slug: {
              jurisdiction: source.jurisdiction,
              slug: row.partySlug,
            },
          },
          create: {
            jurisdiction: source.jurisdiction,
            slug: row.partySlug,
            name: row.partyName,
            shortName: row.partyShortName,
            metadata: { source: { lastImportAt: importedAt, datasetKey: source.key } },
          },
          update: {
            name: row.partyName,
            shortName: row.partyShortName,
            metadata: { source: { lastImportAt: importedAt, datasetKey: source.key } },
          },
          select: { id: true },
        })
        partyId = party.id
        partyIdBySlug.set(row.partySlug, partyId)
        if (existingParty) {
          partiesUpdated += 1
        } else {
          partiesCreated += 1
        }
      }

      const existingAssociation = await tx.politicalDistrictAssociation.findUnique({
        where: {
          jurisdiction_partyId_provinceCode_communitySlug: {
            jurisdiction: source.jurisdiction,
            partyId,
            provinceCode: row.provinceCode,
            communitySlug: row.communitySlug,
          },
        },
        select: { id: true },
      })

      await tx.politicalDistrictAssociation.upsert({
        where: {
          jurisdiction_partyId_provinceCode_communitySlug: {
            jurisdiction: source.jurisdiction,
            partyId,
            provinceCode: row.provinceCode,
            communitySlug: row.communitySlug,
          },
        },
        create: {
          jurisdiction: source.jurisdiction,
          partyId,
          provinceCode: row.provinceCode,
          communitySlug: row.communitySlug,
          electoralDistrictCode: row.electoralDistrictCode,
          associationName: row.associationName,
          registrationStatus: row.registrationStatus,
          sourceDataset: source.key,
          sourceRecordKey: row.sourceRecordKey,
          registeredAt: row.registeredAt,
          deregisteredAt: row.deregisteredAt,
          metadata: row.metadata,
        },
        update: {
          electoralDistrictCode: row.electoralDistrictCode,
          associationName: row.associationName,
          registrationStatus: row.registrationStatus,
          sourceDataset: source.key,
          sourceRecordKey: row.sourceRecordKey,
          registeredAt: row.registeredAt,
          deregisteredAt: row.deregisteredAt,
          metadata: row.metadata,
        },
      })

      if (existingAssociation) {
        associationsUpdated += 1
      } else {
        associationsCreated += 1
      }

      const existingSeat = await tx.politicalSeat.findUnique({
        where: {
          jurisdiction_officeType_provinceCode_communitySlug: {
            jurisdiction: source.jurisdiction,
            officeType: source.officeType,
            provinceCode: row.provinceCode,
            communitySlug: row.communitySlug,
          },
        },
        select: { id: true },
      })

      await tx.politicalSeat.upsert({
        where: {
          jurisdiction_officeType_provinceCode_communitySlug: {
            jurisdiction: source.jurisdiction,
            officeType: source.officeType,
            provinceCode: row.provinceCode,
            communitySlug: row.communitySlug,
          },
        },
        create: {
          jurisdiction: source.jurisdiction,
          officeType: source.officeType,
          provinceCode: row.provinceCode,
          communitySlug: row.communitySlug,
          electoralDistrictCode: row.electoralDistrictCode,
          title: 'Member of Parliament',
          metadata: {
            scrape: { lastScrapeAt: null },
            source: { lastImportAt: importedAt, datasetKey: source.key },
          },
        },
        update: {
          electoralDistrictCode: row.electoralDistrictCode,
          title: 'Member of Parliament',
          metadata: {
            scrape: { lastScrapeAt: null },
            source: { lastImportAt: importedAt, datasetKey: source.key },
          },
        },
      })

      if (existingSeat) {
        seatsUpdated += 1
      } else {
        seatsCreated += 1
      }
    }
  })

  return {
    sourceKey: source.key,
    importedAt,
    rowsProcessed: normalized.length,
    unresolvedRows: unresolved.length,
    unresolvedSample: unresolved.slice(0, 10),
    partiesCreated,
    partiesUpdated,
    associationsCreated,
    associationsUpdated,
    seatsCreated,
    seatsUpdated,
  }
}

async function syncFederalMembersFromOurCommons(queue: Queue<{ scrapeJobId: string }>): Promise<FederalMemberImportSummary> {
  const importedAt = new Date().toISOString()
  const communityLookup = createCommunityLookup()
  const unresolvedSample: FederalMemberImportSummary['unresolvedSample'] = []
  let provincesProcessed = 0
  let membersProcessed = 0
  let unresolvedMembers = 0
  let partiesCreated = 0
  let partiesUpdated = 0
  let politiciansCreated = 0
  let politiciansUpdated = 0
  let seatsCreated = 0
  let seatsUpdated = 0
  let scrapeJobsCreated = 0
  let scrapeJobsRequeued = 0

  for (const provinceCode of OUR_COMMONS_PROVINCE_CODES) {
    const provinceDoc = await fetchXmlDocument(`${OUR_COMMONS_BASE_URL}/Members/en/search/xml?province=${provinceCode}`)
    const members = parseOurCommonsMemberFeed(provinceDoc, provinceCode.toLowerCase())
    provincesProcessed += 1

    for (const member of members) {
      membersProcessed += 1
      const community = pickCommunityFromDistrictName({
        districtName: member.constituencyName,
        headquartersProvince: member.provinceCode,
        communityLookup,
      })
      if (!community) {
        unresolvedMembers += 1
        if (unresolvedSample.length < 10) {
          unresolvedSample.push({
            personId: member.personId,
            constituencyName: member.constituencyName,
            reason: 'district_not_mapped',
          })
        }
        continue
      }

      const district = await prisma.electoralDistrict.findFirst({
        where: {
          provinceCode: member.provinceCode,
          slug: community.slug,
        },
        select: { code: true },
      })

      const scrapeJobId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const partyResolution = await resolveFederalParty(tx, member.caucusShortName, importedAt)
        if (partyResolution.created) {
          partiesCreated += 1
        } else {
          partiesUpdated += 1
        }

        const existingPolitician = await tx.politician.findUnique({
          where: {
            jurisdiction_sourceSystem_sourcePersonId: {
              jurisdiction: PoliticalJurisdiction.FEDERAL,
              sourceSystem: 'ourcommons',
              sourcePersonId: member.personId,
            },
          },
          select: { id: true, metadata: true },
        })

        const politicianMetadata = {
          ...jsonObject(existingPolitician?.metadata),
          source: {
            system: 'ourcommons',
            personId: member.personId,
            importedAt,
            listProvinceCode: provinceCode,
            profileUrl: member.profileUrl,
            xmlUrl: member.xmlUrl,
          },
          ourCommons: {
            personId: member.personId,
            profileUrl: member.profileUrl,
            xmlUrl: member.xmlUrl,
            currentRole: {
              caucusShortName: member.caucusShortName,
              constituencyName: member.constituencyName,
              provinceName: member.provinceName,
              fromDateTime: member.fromDateTime,
              toDateTime: member.toDateTime,
            },
          },
        } satisfies Prisma.InputJsonValue

        const politician = await tx.politician.upsert({
          where: {
            jurisdiction_sourceSystem_sourcePersonId: {
              jurisdiction: PoliticalJurisdiction.FEDERAL,
              sourceSystem: 'ourcommons',
              sourcePersonId: member.personId,
            },
          },
          create: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            slug: buildPoliticianSlug(member.displayName, member.personId),
            displayName: member.displayName,
            firstName: member.firstName,
            lastName: member.lastName,
            officeType: PoliticalOfficeType.MP,
            provinceCode: member.provinceCode,
            communitySlug: community.slug,
            electoralDistrictCode: district?.code ?? null,
            partyId: partyResolution.party.id,
            sourceSystem: 'ourcommons',
            sourcePersonId: member.personId,
            metadata: politicianMetadata,
          },
          update: {
            slug: buildPoliticianSlug(member.displayName, member.personId),
            displayName: member.displayName,
            firstName: member.firstName,
            lastName: member.lastName,
            officeType: PoliticalOfficeType.MP,
            provinceCode: member.provinceCode,
            communitySlug: community.slug,
            electoralDistrictCode: district?.code ?? null,
            partyId: partyResolution.party.id,
            metadata: politicianMetadata,
          },
          select: { id: true },
        })

        if (existingPolitician) {
          politiciansUpdated += 1
        } else {
          politiciansCreated += 1
        }

        const existingSeat = await tx.politicalSeat.findUnique({
          where: {
            jurisdiction_officeType_provinceCode_communitySlug: {
              jurisdiction: PoliticalJurisdiction.FEDERAL,
              officeType: PoliticalOfficeType.MP,
              provinceCode: member.provinceCode,
              communitySlug: community.slug,
            },
          },
          select: { id: true, metadata: true },
        })

        const seatMetadata = {
          ...jsonObject(existingSeat?.metadata),
          source: {
            lastImportAt: importedAt,
            source: 'ourcommons',
            personId: member.personId,
            profileUrl: member.profileUrl,
            xmlUrl: member.xmlUrl,
          },
          scrape: {
            lastScrapeAt: null,
          },
        } satisfies Prisma.InputJsonValue

        await tx.politicalSeat.upsert({
          where: {
            jurisdiction_officeType_provinceCode_communitySlug: {
              jurisdiction: PoliticalJurisdiction.FEDERAL,
              officeType: PoliticalOfficeType.MP,
              provinceCode: member.provinceCode,
              communitySlug: community.slug,
            },
          },
          create: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            officeType: PoliticalOfficeType.MP,
            provinceCode: member.provinceCode,
            communitySlug: community.slug,
            electoralDistrictCode: district?.code ?? null,
            title: 'Member of Parliament',
            currentPoliticianId: politician.id,
            currentPartyId: partyResolution.party.id,
            metadata: seatMetadata,
          },
          update: {
            electoralDistrictCode: district?.code ?? null,
            title: 'Member of Parliament',
            currentPoliticianId: politician.id,
            currentPartyId: partyResolution.party.id,
            metadata: seatMetadata,
          },
        })

        if (existingSeat) {
          seatsUpdated += 1
        } else {
          seatsCreated += 1
        }

        const existingScrapeJob = await tx.politicianScrapeJob.findUnique({
          where: {
            politicianId_source: {
              politicianId: politician.id,
              source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_XML,
            },
          },
          select: { id: true },
        })

        const scrapeJob = await tx.politicianScrapeJob.upsert({
          where: {
            politicianId_source: {
              politicianId: politician.id,
              source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_XML,
            },
          },
          create: {
            politicianId: politician.id,
            source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_XML,
            status: PoliticianScrapeJobStatus.QUEUED,
            personId: member.personId,
            xmlUrl: member.xmlUrl,
            profileUrl: member.profileUrl,
            queuedAt: new Date(importedAt),
            nextRunAt: new Date(importedAt),
            lastError: null,
            payload: {
              provinceCode: member.provinceCode,
              communitySlug: community.slug,
              constituencyName: member.constituencyName,
            },
          },
          update: {
            status: PoliticianScrapeJobStatus.QUEUED,
            personId: member.personId,
            xmlUrl: member.xmlUrl,
            profileUrl: member.profileUrl,
            queuedAt: new Date(importedAt),
            nextRunAt: new Date(importedAt),
            lastError: null,
            payload: {
              provinceCode: member.provinceCode,
              communitySlug: community.slug,
              constituencyName: member.constituencyName,
            },
          },
          select: { id: true },
        })

        if (existingScrapeJob) {
          scrapeJobsRequeued += 1
        } else {
          scrapeJobsCreated += 1
        }

        return scrapeJob.id
      })

      const queueJobId = `politician-scrape-${scrapeJobId}`
      const existingQueueJob = await queue.getJob(queueJobId)
      if (existingQueueJob) {
        const state = await existingQueueJob.getState()
        if (state === 'completed' || state === 'failed') {
          await existingQueueJob.remove().catch(() => null)
        }
      }

      const queueJobAfterCleanup = await queue.getJob(queueJobId)
      if (!queueJobAfterCleanup) {
        await queue.add(
          'ourcommons-member-xml',
          { scrapeJobId },
          {
            jobId: queueJobId,
            removeOnComplete: 500,
            removeOnFail: 500,
          },
        )
      }
    }
  }

  return {
    importedAt,
    provincesProcessed,
    membersProcessed,
    unresolvedMembers,
    unresolvedSample,
    partiesCreated,
    partiesUpdated,
    politiciansCreated,
    politiciansUpdated,
    seatsCreated,
    seatsUpdated,
    scrapeJobsCreated,
    scrapeJobsRequeued,
  }
}

async function loadFederalDatasetStats() {
  const [partyStats, associationStats, seatStats, occupiedSeatCount, politicianStats, importedCommonsPoliticians, scrapeJobStats, queuedJobs, processingJobs, completedJobs, failedJobs, xmlScrapeJobs, htmlScrapeJobs] = await Promise.all([
    prisma.politicalParty.aggregate({
      where: { jurisdiction: PoliticalJurisdiction.FEDERAL },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politicalDistrictAssociation.aggregate({
      where: { jurisdiction: PoliticalJurisdiction.FEDERAL },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politicalSeat.aggregate({
      where: { jurisdiction: PoliticalJurisdiction.FEDERAL, officeType: PoliticalOfficeType.MP },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politicalSeat.count({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        officeType: PoliticalOfficeType.MP,
        currentPoliticianId: { not: null },
      },
    }),
    prisma.politician.aggregate({
      where: { jurisdiction: PoliticalJurisdiction.FEDERAL },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politician.findMany({
      where: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        sourceSystem: 'ourcommons',
      },
      select: { metadata: true },
    }),
    prisma.politicianScrapeJob.aggregate({
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politicianScrapeJob.count({ where: { status: PoliticianScrapeJobStatus.QUEUED } }),
    prisma.politicianScrapeJob.count({ where: { status: PoliticianScrapeJobStatus.PROCESSING } }),
    prisma.politicianScrapeJob.count({ where: { status: PoliticianScrapeJobStatus.COMPLETED } }),
    prisma.politicianScrapeJob.count({ where: { status: PoliticianScrapeJobStatus.FAILED } }),
    loadScrapeJobSourceStats(PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_XML),
    loadScrapeJobSourceStats(PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_HTML),
  ])

  let politiciansWithProfileUrl = 0
  let xmlSynced = 0
  let htmlSynced = 0
  let photos = 0
  let emails = 0
  let websites = 0
  let hillOffices = 0
  let constituencyOffices = 0
  let lastXmlSyncAt: string | null = null
  let lastHtmlSyncAt: string | null = null

  for (const politician of importedCommonsPoliticians) {
    const metadata = jsonObject(politician.metadata)
    const ourCommons = jsonObject(metadata.ourCommons as Prisma.JsonValue | null)
    const contact = jsonObject(ourCommons.contact as Prisma.JsonValue | null)
    const profileUrl = typeof ourCommons.profileUrl === 'string' && ourCommons.profileUrl.trim() ? ourCommons.profileUrl.trim() : null
    const xmlSyncAt = typeof ourCommons.lastXmlSyncAt === 'string' && ourCommons.lastXmlSyncAt.trim() ? ourCommons.lastXmlSyncAt.trim() : null
    const htmlSyncAt = typeof ourCommons.lastHtmlSyncAt === 'string' && ourCommons.lastHtmlSyncAt.trim() ? ourCommons.lastHtmlSyncAt.trim() : null
    const photoUrl = typeof ourCommons.photoUrl === 'string' && ourCommons.photoUrl.trim() ? ourCommons.photoUrl.trim() : null
    const email = typeof contact.email === 'string' && contact.email.trim() ? contact.email.trim() : null
    const website = typeof contact.website === 'string' && contact.website.trim() ? contact.website.trim() : null
    const hillOffice = jsonObject(contact.hillOffice as Prisma.JsonValue | null)
    const constituencyOfficeList = Array.isArray(contact.constituencyOffices) ? contact.constituencyOffices : []

    if (profileUrl) politiciansWithProfileUrl += 1
    if (xmlSyncAt) {
      xmlSynced += 1
      if (!lastXmlSyncAt || xmlSyncAt > lastXmlSyncAt) lastXmlSyncAt = xmlSyncAt
    }
    if (htmlSyncAt) {
      htmlSynced += 1
      if (!lastHtmlSyncAt || htmlSyncAt > lastHtmlSyncAt) lastHtmlSyncAt = htmlSyncAt
    }
    if (photoUrl) photos += 1
    if (email) emails += 1
    if (website) websites += 1
    if (Object.keys(hillOffice).length > 0) hillOffices += 1
    if (constituencyOfficeList.length > 0) constituencyOffices += 1
  }

  const currentMembers = importedCommonsPoliticians.length
  const vacantSeats = Math.max((seatStats._count ?? 0) - occupiedSeatCount, 0)
  const remainingXmlSync = Math.max(currentMembers - xmlSynced, 0)
  const remainingHtmlSync = Math.max(currentMembers - htmlSynced, 0)

  let commonsCoverageStatus: CommonsCoverageStatus = 'needs_refresh'
  if (xmlScrapeJobs.failed > 0 || htmlScrapeJobs.failed > 0) {
    commonsCoverageStatus = 'attention'
  } else if (xmlScrapeJobs.queued > 0 || xmlScrapeJobs.processing > 0 || htmlScrapeJobs.queued > 0 || htmlScrapeJobs.processing > 0) {
    commonsCoverageStatus = 'in_progress'
  } else if (currentMembers > 0 && remainingXmlSync === 0 && remainingHtmlSync === 0) {
    commonsCoverageStatus = 'up_to_date'
  }

  return {
    parties: {
      count: partyStats._count ?? 0,
      lastUpdatedAt: partyStats._max.updatedAt?.toISOString() ?? null,
    },
    associations: {
      count: associationStats._count ?? 0,
      lastUpdatedAt: associationStats._max.updatedAt?.toISOString() ?? null,
    },
    seats: {
      count: seatStats._count ?? 0,
      occupied: occupiedSeatCount,
      vacant: vacantSeats,
      lastUpdatedAt: seatStats._max.updatedAt?.toISOString() ?? null,
    },
    politicians: {
      count: politicianStats._count ?? 0,
      lastUpdatedAt: politicianStats._max.updatedAt?.toISOString() ?? null,
    },
    scrapeJobs: {
      count: scrapeJobStats._count ?? 0,
      queued: queuedJobs,
      processing: processingJobs,
      completed: completedJobs,
      failed: failedJobs,
      lastUpdatedAt: scrapeJobStats._max.updatedAt?.toISOString() ?? null,
      xml: xmlScrapeJobs,
      html: htmlScrapeJobs,
    },
    commonsCoverage: {
      currentMembers,
      occupiedSeats: occupiedSeatCount,
      vacantSeats,
      politiciansWithProfileUrl,
      xmlSynced,
      htmlSynced,
      photos,
      emails,
      websites,
      hillOffices,
      constituencyOffices,
      remainingXmlSync,
      remainingHtmlSync,
      lastXmlSyncAt,
      lastHtmlSyncAt,
      status: commonsCoverageStatus,
    },
  }
}

async function loadScrapeJobSourceStats(source: PoliticianScrapeJobSource): Promise<ScrapeJobBucketStat> {
  const [jobStats, queuedJobs, processingJobs, completedJobs, failedJobs] = await Promise.all([
    prisma.politicianScrapeJob.aggregate({
      where: { source },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.politicianScrapeJob.count({ where: { source, status: PoliticianScrapeJobStatus.QUEUED } }),
    prisma.politicianScrapeJob.count({ where: { source, status: PoliticianScrapeJobStatus.PROCESSING } }),
    prisma.politicianScrapeJob.count({ where: { source, status: PoliticianScrapeJobStatus.COMPLETED } }),
    prisma.politicianScrapeJob.count({ where: { source, status: PoliticianScrapeJobStatus.FAILED } }),
  ])

  return {
    count: jobStats._count ?? 0,
    queued: queuedJobs,
    processing: processingJobs,
    completed: completedJobs,
    failed: failedJobs,
    lastUpdatedAt: jobStats._max.updatedAt?.toISOString() ?? null,
  }
}

async function loadFederalDatasetStatsSafe() {
  try {
    return {
      databaseReady: true,
      stats: await loadFederalDatasetStats(),
    }
  } catch (error) {
    if (isPoliticalStorageUnavailableError(error)) {
      return {
        databaseReady: false,
        stats: buildEmptyPoliticalDatasetStats(),
      }
    }
    throw error
  }
}

function readLastScrapeAt(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const scrape = (metadata as Record<string, unknown>).scrape
  if (!scrape || typeof scrape !== 'object' || Array.isArray(scrape)) return null
  const lastScrapeAt = (scrape as Record<string, unknown>).lastScrapeAt
  return typeof lastScrapeAt === 'string' && lastScrapeAt.trim() ? lastScrapeAt : null
}

function readOurCommonsOffice(value: unknown): OurCommonsOfficeSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : null
  const lines = Array.isArray(record.lines)
    ? record.lines.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : []
  const telephone = typeof record.telephone === 'string' && record.telephone.trim() ? record.telephone.trim() : null
  const fax = typeof record.fax === 'string' && record.fax.trim() ? record.fax.trim() : null

  if (!label && !lines.length && !telephone && !fax) return null
  return { label, lines, telephone, fax }
}

function readOurCommonsProfile(metadata: Prisma.JsonValue | null): OurCommonsProfileSummary {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      profileUrl: null,
      xmlUrl: null,
      photoUrl: null,
      lastXmlSyncAt: null,
      lastHtmlSyncAt: null,
      contact: {
        email: null,
        website: null,
        hillOffice: null,
        constituencyOffices: [],
      },
    }
  }

  const ourCommons = (metadata as Record<string, unknown>).ourCommons
  if (!ourCommons || typeof ourCommons !== 'object' || Array.isArray(ourCommons)) {
    return {
      profileUrl: null,
      xmlUrl: null,
      photoUrl: null,
      lastXmlSyncAt: null,
      lastHtmlSyncAt: null,
      contact: {
        email: null,
        website: null,
        hillOffice: null,
        constituencyOffices: [],
      },
    }
  }

  const record = ourCommons as Record<string, unknown>
  const contact = record.contact && typeof record.contact === 'object' && !Array.isArray(record.contact) ? (record.contact as Record<string, unknown>) : null
  return {
    profileUrl: typeof record.profileUrl === 'string' && record.profileUrl.trim() ? record.profileUrl.trim() : null,
    xmlUrl: typeof record.xmlUrl === 'string' && record.xmlUrl.trim() ? record.xmlUrl.trim() : null,
    photoUrl: typeof record.photoUrl === 'string' && record.photoUrl.trim() ? record.photoUrl.trim() : null,
    lastXmlSyncAt: typeof record.lastXmlSyncAt === 'string' && record.lastXmlSyncAt.trim() ? record.lastXmlSyncAt.trim() : null,
    lastHtmlSyncAt: typeof record.lastHtmlSyncAt === 'string' && record.lastHtmlSyncAt.trim() ? record.lastHtmlSyncAt.trim() : null,
    contact: {
      email: contact && typeof contact.email === 'string' && contact.email.trim() ? contact.email.trim() : null,
      website: contact && typeof contact.website === 'string' && contact.website.trim() ? contact.website.trim() : null,
      hillOffice: contact ? readOurCommonsOffice(contact.hillOffice) : null,
      constituencyOffices: contact && Array.isArray(contact.constituencyOffices)
        ? contact.constituencyOffices.map((entry) => readOurCommonsOffice(entry)).filter((entry): entry is OurCommonsOfficeSummary => entry !== null)
        : [],
    },
  }
}

function readOurCommonsLinks(metadata: Prisma.JsonValue | null) {
  const { profileUrl, xmlUrl } = readOurCommonsProfile(metadata)
  return { profileUrl, xmlUrl }
}

function readAssociationRepresentative(metadata: Prisma.JsonValue | null): { displayName: string; roleLabel: string } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const source = (metadata as Record<string, unknown>).source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const sourceRecord = source as Record<string, unknown>

  const ceoName = typeof sourceRecord.ceoName === 'string' ? sourceRecord.ceoName.trim() : ''
  if (ceoName) {
    return { displayName: ceoName, roleLabel: '' }
  }

  const financialAgentName = typeof sourceRecord.financialAgentName === 'string' ? sourceRecord.financialAgentName.trim() : ''
  if (financialAgentName) {
    return { displayName: financialAgentName, roleLabel: '' }
  }

  return null
}

async function enqueueFederalMemberDetailScrapes(queue: Queue<{ scrapeJobId: string }>): Promise<FederalMemberDetailFetchSummary> {
  const enqueuedAt = new Date().toISOString()
  const politicians = await prisma.politician.findMany({
    where: {
      jurisdiction: PoliticalJurisdiction.FEDERAL,
      sourceSystem: 'ourcommons',
    },
    select: {
      id: true,
      metadata: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  let jobsCreated = 0
  let jobsRequeued = 0
  let jobsAlreadyQueued = 0
  let skippedMissingProfileUrl = 0

  for (const politician of politicians) {
    const links = readOurCommonsLinks(politician.metadata)
    if (!links.profileUrl) {
      skippedMissingProfileUrl += 1
      continue
    }

    const scrapeJobId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingScrapeJob = await tx.politicianScrapeJob.findUnique({
        where: {
          politicianId_source: {
            politicianId: politician.id,
            source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_HTML,
          },
        },
        select: { id: true },
      })

      const scrapeJob = await tx.politicianScrapeJob.upsert({
        where: {
          politicianId_source: {
            politicianId: politician.id,
            source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_HTML,
          },
        },
        create: {
          politicianId: politician.id,
          source: PoliticianScrapeJobSource.OUR_COMMONS_MEMBER_HTML,
          status: PoliticianScrapeJobStatus.QUEUED,
          profileUrl: links.profileUrl,
          queuedAt: new Date(enqueuedAt),
          nextRunAt: new Date(enqueuedAt),
          lastError: null,
          payload: {
            contactUrl: `${links.profileUrl}#contact`,
            rolesUrl: `${links.profileUrl}#roles`,
          },
        },
        update: {
          status: PoliticianScrapeJobStatus.QUEUED,
          profileUrl: links.profileUrl,
          queuedAt: new Date(enqueuedAt),
          nextRunAt: new Date(enqueuedAt),
          lastError: null,
          payload: {
            contactUrl: `${links.profileUrl}#contact`,
            rolesUrl: `${links.profileUrl}#roles`,
          },
        },
        select: { id: true },
      })

      if (existingScrapeJob) {
        jobsRequeued += 1
      } else {
        jobsCreated += 1
      }

      return scrapeJob.id
    })

    const queueJobId = `politician-scrape-${scrapeJobId}`
    const existingQueueJob = await queue.getJob(queueJobId)
    if (existingQueueJob) {
      const state = await existingQueueJob.getState()
      if (state === 'completed' || state === 'failed') {
        await existingQueueJob.remove().catch(() => null)
      } else {
        jobsAlreadyQueued += 1
      }
    }

    const queueJobAfterCleanup = await queue.getJob(queueJobId)
    if (!queueJobAfterCleanup) {
      await queue.add(
        'ourcommons-member-html',
        { scrapeJobId },
        {
          jobId: queueJobId,
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      )
    }
  }

  return {
    enqueuedAt,
    politiciansConsidered: politicians.length,
    jobsCreated,
    jobsRequeued,
    jobsAlreadyQueued,
    skippedMissingProfileUrl,
  }
}

export function registerPoliticianRoutes(app: FastifyInstance, deps: PoliticiansRouteDeps) {
  app.get('/admin/eda', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const { databaseReady, stats } = await loadFederalDatasetStatsSafe()
    const sources = await Promise.all(
      FEDERAL_DATASET_SOURCES.map(async (source) => {
        try {
          const filePath = await resolveDatasetPath(source.filename)
          const fileStats = await fs.stat(filePath)
          return {
            key: source.key,
            label: source.label,
            jurisdiction: source.jurisdiction,
            officeType: source.officeType,
            available: true,
            updatedAt: fileStats.mtime.toISOString(),
          }
        } catch {
          return {
            key: source.key,
            label: source.label,
            jurisdiction: source.jurisdiction,
            officeType: source.officeType,
            available: false,
            updatedAt: null,
          }
        }
      }),
    )

    return reply.send({
      generatedAt: new Date().toISOString(),
      databaseReady,
      sources,
      stats,
    })
  })

  app.post('/admin/eda/import', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    const parse = ADMIN_EDA_IMPORT_BODY.safeParse(req.body ?? {})
    if (!parse.success) return reply.code(400).send({ error: parse.error.flatten() })

    const source = FEDERAL_DATASET_SOURCES.find((entry) => entry.key === parse.data.sourceKey)
    if (!source) return reply.code(404).send({ error: 'source_not_found' })

    try {
      const readiness = await loadFederalDatasetStatsSafe()
      if (!readiness.databaseReady) {
        return reply.code(503).send({ error: 'political_tables_not_ready' })
      }

      const summary = await importFederalAssociations(source)
      const stats = await loadFederalDatasetStats()
      return reply.send({ ok: true, summary, stats })
    } catch (error) {
      console.error('eda_import_failed', error)
      return reply.code(500).send({ error: 'eda_import_failed' })
    }
  })

  app.post('/admin/eda/federal-members/fetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    try {
      const readiness = await loadFederalDatasetStatsSafe()
      if (!readiness.databaseReady) {
        return reply.code(503).send({ error: 'political_tables_not_ready' })
      }

      const summary = await syncFederalMembersFromOurCommons(deps.politicianScrapeQueue)
      const stats = await loadFederalDatasetStats()
      return reply.send({ ok: true, summary, stats })
    } catch (error) {
      console.error('commons_federal_member_fetch_failed', error)
      const detail = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ error: 'commons_federal_member_fetch_failed', detail })
    }
  })

  app.post('/admin/eda/federal-members/details/fetch', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.loadAdminUserOrReply(req, reply)
    if (!user) return

    try {
      const readiness = await loadFederalDatasetStatsSafe()
      if (!readiness.databaseReady) {
        return reply.code(503).send({ error: 'political_tables_not_ready' })
      }

      const summary = await enqueueFederalMemberDetailScrapes(deps.politicianScrapeQueue)
      const stats = await loadFederalDatasetStats()
      return reply.send({ ok: true, summary, stats })
    } catch (error) {
      console.error('commons_federal_member_detail_fetch_failed', error)
      const detail = error instanceof Error ? error.message : String(error)
      return reply.code(500).send({ error: 'commons_federal_member_detail_fetch_failed', detail })
    }
  })

  app.get('/communities/:province/:municipality/politicians', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = COMMUNITY_POLITICIANS_PARAMS.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const provinceCode = normalizeProvinceCode(params.data.province)
    if (!provinceCode) return reply.code(404).send({ error: 'province_not_found' })

    const communitySlug = params.data.municipality.trim().toLowerCase()
    const community = findCommunity(provinceCode, communitySlug)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    let seat: Awaited<ReturnType<typeof prisma.politicalSeat.findUnique>> = null
    let associations: Awaited<ReturnType<typeof prisma.politicalDistrictAssociation.findMany>> = []
    let politiciansByPartyId = new Map<string, {
      slug: string
      displayName: string
      photoUrl: string | null
      roleLabel: string
    }>()

    try {
      ;[seat, associations] = await Promise.all([
        prisma.politicalSeat.findUnique({
          where: {
            jurisdiction_officeType_provinceCode_communitySlug: {
              jurisdiction: PoliticalJurisdiction.FEDERAL,
              officeType: PoliticalOfficeType.MP,
              provinceCode,
              communitySlug: community.slug,
            },
          },
          include: {
            currentParty: { select: { id: true, name: true, slug: true, shortName: true } },
            currentPolitician: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                metadata: true,
              },
            },
          },
        }),
        prisma.politicalDistrictAssociation.findMany({
          where: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            provinceCode,
            communitySlug: community.slug,
          },
          orderBy: [{ party: { name: 'asc' } }],
          include: {
            party: { select: { id: true, name: true, slug: true, shortName: true } },
          },
        }),
      ])

      const partyIds = associations.map((association: (typeof associations)[number]) => association.party.id)
      if (partyIds.length) {
        const politicians = await prisma.politician.findMany({
          where: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            provinceCode,
            communitySlug: community.slug,
            partyId: { in: partyIds },
          },
          orderBy: [{ displayName: 'asc' }],
          select: {
            partyId: true,
            slug: true,
            displayName: true,
            metadata: true,
          },
        })

        politicians.forEach((politician: (typeof politicians)[number]) => {
          if (!politician.partyId || politiciansByPartyId.has(politician.partyId)) return
          politiciansByPartyId.set(politician.partyId, {
            slug: politician.slug,
            displayName: politician.displayName,
            photoUrl: readOurCommonsProfile(politician.metadata).photoUrl,
            roleLabel: '',
          })
        })
      }
    } catch (error) {
      if (!isPoliticalStorageUnavailableError(error)) throw error
    }

    return reply.send({
      community: {
        provinceCode,
        communitySlug: community.slug,
        name: community.name,
      },
      federal: {
        seat: seat
          ? {
              title: seat.title,
              politician: seat.currentPolitician
                ? {
                    id: seat.currentPolitician.id,
                    slug: seat.currentPolitician.slug,
                    displayName: seat.currentPolitician.displayName,
                    lastScrapeAt: readLastScrapeAt(seat.currentPolitician.metadata),
                    ...readOurCommonsProfile(seat.currentPolitician.metadata),
                  }
                : null,
              party: seat.currentParty
                ? {
                    id: seat.currentParty.id,
                    name: seat.currentParty.name,
                    slug: seat.currentParty.slug,
                    shortName: seat.currentParty.shortName,
                  }
                : null,
              lastScrapeAt: readLastScrapeAt(seat.metadata),
            }
          : null,
        associations: associations.map((association: (typeof associations)[number]) => {
          const linkedPolitician = politiciansByPartyId.get(association.party.id) ?? null
          const fallbackRepresentative = linkedPolitician ? null : readAssociationRepresentative(association.metadata)

          return {
            id: association.id,
            associationName: association.associationName,
            registrationStatus: association.registrationStatus,
            registeredAt: association.registeredAt?.toISOString() ?? null,
            deregisteredAt: association.deregisteredAt?.toISOString() ?? null,
            party: {
              id: association.party.id,
              slug: association.party.slug,
              name: association.party.name,
              shortName: association.party.shortName,
            },
            registeredMember: linkedPolitician
              ? linkedPolitician
              : fallbackRepresentative
                ? {
                    slug: null,
                    displayName: fallbackRepresentative.displayName,
                    photoUrl: null,
                    roleLabel: fallbackRepresentative.roleLabel,
                  }
                : null,
          }
        }),
      },
    })
  })

  app.get('/communities/:province/:municipality/electoral-district', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = COMMUNITY_POLITICIANS_PARAMS.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() })

    const provinceCode = normalizeProvinceCode(params.data.province)
    if (!provinceCode) return reply.code(404).send({ error: 'community_not_found' })

    const community = findCommunity(provinceCode, params.data.municipality)
    if (!community) return reply.code(404).send({ error: 'community_not_found' })

    try {
      const payload = await resolveCommunityElectoralDistrictContext({
        provinceCode,
        communitySlug: community.slug,
      })

      return reply.send(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'community_electoral_district_failed'
      if (message === 'postgis_not_enabled') return reply.code(503).send({ error: message })
      req.log.error({ err: error }, 'community_electoral_district_failed')
      return reply.code(500).send({ error: 'community_electoral_district_failed' })
    }
  })

  app.get('/politicians/federal', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = FEDERAL_PARTY_QUERY.safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: query.error.flatten() })

    let items: Awaited<ReturnType<typeof prisma.politicalParty.findMany>> = []
    let registeredAssociationCounts: Array<{ partyId: string; _count: { _all: number } }> = []
    try {
      items = await prisma.politicalParty.findMany({
        where: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          ...(query.data.q ? { name: { contains: query.data.q, mode: 'insensitive' } } : {}),
        },
        orderBy: [{ name: 'asc' }],
        take: query.data.limit,
        include: {
          politicians: {
            where: { jurisdiction: PoliticalJurisdiction.FEDERAL },
            orderBy: [{ displayName: 'asc' }],
            take: 1,
            select: {
              slug: true,
              displayName: true,
              metadata: true,
            },
          },
          _count: {
            select: {
              associations: true,
              politicians: true,
              seats: true,
            },
          },
        },
      })

      const partyIds = items.map((party: (typeof items)[number]) => party.id)
      if (partyIds.length) {
        registeredAssociationCounts = await prisma.politicalDistrictAssociation.groupBy({
          by: ['partyId'],
          where: {
            partyId: { in: partyIds },
            deregisteredAt: null,
            NOT: {
              registrationStatus: {
                contains: 'deregister',
                mode: 'insensitive',
              },
            },
          },
          _count: {
            _all: true,
          },
        })
      }
    } catch (error) {
      if (!isPoliticalStorageUnavailableError(error)) throw error
    }

    const registeredAssociationCountByPartyId = new Map(
      registeredAssociationCounts.map((entry) => [entry.partyId, entry._count._all]),
    )

    return reply.send({
      items: items.map((party: (typeof items)[number]) => ({
        id: party.id,
        slug: party.slug,
        name: party.name,
        shortName: party.shortName,
        associationCount: party._count.associations,
        registeredAssociationCount: registeredAssociationCountByPartyId.get(party.id) ?? 0,
        politicianCount: party._count.politicians,
        seatCount: party._count.seats,
        updatedAt: party.updatedAt.toISOString(),
        previewPolitician: party.politicians[0]
          ? {
              slug: party.politicians[0].slug,
              displayName: party.politicians[0].displayName,
              lastScrapeAt: readLastScrapeAt(party.politicians[0].metadata),
              photoUrl: readOurCommonsProfile(party.politicians[0].metadata).photoUrl,
            }
          : null,
      })),
    })
  })

  app.get('/politicians/federal/:partySlug', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = FEDERAL_PARTY_PARAMS.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    let party: Awaited<ReturnType<typeof prisma.politicalParty.findUnique>> = null
    try {
      party = await prisma.politicalParty.findUnique({
        where: {
          jurisdiction_slug: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            slug: params.data.partySlug.trim().toLowerCase(),
          },
        },
        include: {
          politicians: {
            orderBy: [{ displayName: 'asc' }],
            select: {
              id: true,
              slug: true,
              displayName: true,
              officeType: true,
              provinceCode: true,
              communitySlug: true,
              metadata: true,
              electoralDistrict: {
                select: {
                  name: true,
                  slug: true,
                  provinceCode: true,
                },
              },
            },
          },
          associations: {
            orderBy: [{ provinceCode: 'asc' }, { communitySlug: 'asc' }],
            select: {
              id: true,
              associationName: true,
              registrationStatus: true,
              provinceCode: true,
              communitySlug: true,
              registeredAt: true,
              deregisteredAt: true,
            },
          },
        },
      })
    } catch (error) {
      if (isPoliticalStorageUnavailableError(error)) {
        return reply.code(404).send({ error: 'party_not_found' })
      }
      throw error
    }

    if (!party) return reply.code(404).send({ error: 'party_not_found' })

    return reply.send({
      party: {
        id: party.id,
        slug: party.slug,
        name: party.name,
        shortName: party.shortName,
        updatedAt: party.updatedAt.toISOString(),
      },
      politicians: party.politicians.map((politician: (typeof party.politicians)[number]) => ({
        id: politician.id,
        slug: politician.slug,
        displayName: politician.displayName,
        officeType: politician.officeType,
        provinceCode: politician.provinceCode,
        communitySlug: politician.communitySlug,
        lastScrapeAt: readLastScrapeAt(politician.metadata),
        ...readOurCommonsProfile(politician.metadata),
        district: politician.electoralDistrict
          ? {
              name: politician.electoralDistrict.name,
              slug: politician.electoralDistrict.slug,
              provinceCode: politician.electoralDistrict.provinceCode,
            }
          : null,
      })),
      associations: party.associations.map((association: (typeof party.associations)[number]) => ({
        id: association.id,
        associationName: association.associationName,
        registrationStatus: association.registrationStatus,
        provinceCode: association.provinceCode,
        communitySlug: association.communitySlug,
        registeredAt: association.registeredAt?.toISOString() ?? null,
        deregisteredAt: association.deregisteredAt?.toISOString() ?? null,
      })),
    })
  })

  app.get('/politicians/federal/:partySlug/districts', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = FEDERAL_PARTY_PARAMS.safeParse(req.params)
    const query = FEDERAL_PARTY_DISTRICTS_QUERY.safeParse(req.query)
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_params' })

    const rawProvinceCode = query.data.provinceCode?.trim().toLowerCase() || null
    const provinceCode = !rawProvinceCode || rawProvinceCode === 'all' || rawProvinceCode === 'ca'
      ? null
      : normalizeProvinceCode(rawProvinceCode)
    if (rawProvinceCode && rawProvinceCode !== 'all' && rawProvinceCode !== 'ca' && !provinceCode) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    try {
      const payload = await browseFederalPartyDistricts({
        partySlug: params.data.partySlug,
        provinceCode,
      })

      return reply.send(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'party_districts_failed'
      if (message === 'party_not_found') return reply.code(404).send({ error: message })
      if (message === 'postgis_not_enabled') return reply.code(503).send({ error: message })
      req.log.error({ err: error }, 'party_districts_failed')
      return reply.code(500).send({ error: 'party_districts_failed' })
    }
  })

  app.get('/politicians/federal/:partySlug/:memberSlug', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = FEDERAL_MEMBER_PARAMS.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    let politician: Awaited<ReturnType<typeof prisma.politician.findFirst>> = null
    try {
      politician = await prisma.politician.findFirst({
        where: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          slug: params.data.memberSlug.trim().toLowerCase(),
          party: {
            jurisdiction: PoliticalJurisdiction.FEDERAL,
            slug: params.data.partySlug.trim().toLowerCase(),
          },
        },
        include: {
          party: { select: { id: true, slug: true, name: true, shortName: true } },
          electoralDistrict: { select: { code: true, slug: true, name: true, provinceCode: true } },
        },
      })
    } catch (error) {
      if (isPoliticalStorageUnavailableError(error)) {
        return reply.code(404).send({ error: 'politician_not_found' })
      }
      throw error
    }

    if (!politician) return reply.code(404).send({ error: 'politician_not_found' })

    return reply.send({
      politician: {
        id: politician.id,
        slug: politician.slug,
        displayName: politician.displayName,
        firstName: politician.firstName,
        lastName: politician.lastName,
        officeType: politician.officeType,
        provinceCode: politician.provinceCode,
        communitySlug: politician.communitySlug,
        lastScrapeAt: readLastScrapeAt(politician.metadata),
        ...readOurCommonsProfile(politician.metadata),
        party: politician.party,
        district: politician.electoralDistrict
          ? {
              code: politician.electoralDistrict.code,
              slug: politician.electoralDistrict.slug,
              name: politician.electoralDistrict.name,
              provinceCode: politician.electoralDistrict.provinceCode,
            }
          : null,
      },
    })
  })
}
