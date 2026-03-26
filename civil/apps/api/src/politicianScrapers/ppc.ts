import { prisma } from '@civil/db'
import { PoliticalJurisdiction, PoliticalOfficeType, Prisma } from '@prisma/client'
import { PROVINCES, slugifyCommunityName } from '@civil/shared'
import { chromium } from 'playwright'

const PPC_CANDIDATES_URL = 'https://www.peoplespartyofcanada.ca/candidates'
const PPC_PARTY_SLUG = 'peoples-party-of-canada'
const PPC_PARTY_NAME = "People's Party of Canada"
const PPC_PARTY_SHORT_NAME = "People's Party"
const PPC_TIMEOUT_MS = 60_000
const PPC_LISTING_EVAL = String.raw`(() => {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()
  const cards = Array.from(document.querySelectorAll('a[href*="/candidate/"]'))
    .map((anchor) => {
      const heading = normalize(anchor.querySelector('h3')?.textContent)
      const contentRoot = anchor.querySelector('.social-media-card-content')
      const parts = contentRoot
        ? Array.from(contentRoot.children)
          .map((node) => normalize(node.textContent))
          .filter(Boolean)
          .filter((value) => !/^read more$/i.test(value))
        : []
      const ridingName = parts.find((value) => value !== heading) || ''
      const provinceName = parts.filter((value) => value !== heading && value !== ridingName)[0] || ''
      const href = anchor.href ? new URL(anchor.href, window.location.href).toString() : ''
      const slugMatch = href.match(/\/candidate\/([^/?#]+)/i)
      const candidateSlug = slugMatch?.[1]?.trim().toLowerCase() || ''
      const photoUrl = anchor.querySelector('img.candidate_icon')?.src || anchor.querySelector('img')?.src || ''
      const images = Array.from(anchor.querySelectorAll('img')).map((img) => img.src).filter(Boolean)
      const backgroundImageUrl = images.find((src) => src !== photoUrl) || ''

      return {
        candidateSlug,
        candidateUrl: href,
        displayName: heading,
        ridingName,
        provinceName,
        photoUrl: photoUrl || null,
        backgroundImageUrl: backgroundImageUrl || null,
      }
    })
    .filter((card) => card.candidateSlug && card.candidateUrl && card.displayName && card.ridingName && card.provinceName)

  const nextHref = Array.from(document.querySelectorAll('a[href]'))
    .map((anchor) => ({ href: anchor.href, text: normalize(anchor.textContent) }))
    .find((anchor) => /^next page$/i.test(anchor.text))?.href || null

  return { cards, nextHref }
})()`

type PpcCandidateCard = {
  candidateSlug: string
  candidateUrl: string
  displayName: string
  ridingName: string
  provinceName: string
  photoUrl: string | null
  backgroundImageUrl: string | null
}

type ElectoralDistrictRecord = {
  code: number
  name: string
  slug: string
  provinceCode: string
}

type ScrapeSummaryItem = {
  displayName: string
  ridingName: string
  provinceName: string
  reason: string
}

export type PpcCandidateImportSummary = {
  importedAt: string
  sourceUrl: string
  cardsFound: number
  matchedDistricts: number
  politiciansCreated: number
  politiciansUpdated: number
  unmatchedCards: number
  unmatchedSample: ScrapeSummaryItem[]
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function normalizeMatchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function provinceCodeFromName(value: string) {
  const normalized = normalizeMatchText(value)
  if (!normalized) return null

  const overrideMap: Record<string, string> = {
    'british columbia': 'bc',
    'newfoundland': 'nl',
    'newfoundland labrador': 'nl',
    'northwest territories': 'nt',
    'prince edward island': 'pe',
  }

  if (overrideMap[normalized]) return overrideMap[normalized]

  const province = PROVINCES.find((entry: (typeof PROVINCES)[number]) => normalizeMatchText(entry.name) === normalized)
  return province?.code ?? null
}

function buildPoliticianSlug(displayName: string, candidateSlug: string) {
  return `${slugifyCommunityName(displayName)}-ppc-${candidateSlug}`
}

function splitName(displayName: string) {
  const parts = displayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) {
    return { firstName: null, lastName: null }
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

function buildDistrictMaps(rows: ElectoralDistrictRecord[]) {
  const byName = new Map<string, ElectoralDistrictRecord>()
  const bySlug = new Map<string, ElectoralDistrictRecord>()

  rows.forEach((row) => {
    byName.set(`${row.provinceCode}:${normalizeMatchText(row.name)}`, row)
    bySlug.set(`${row.provinceCode}:${row.slug}`, row)
  })

  return { byName, bySlug }
}

async function scrapePpcCandidateCards() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const visitedPages = new Set<string>()
  const cardsByUrl = new Map<string, PpcCandidateCard>()

  try {
    let nextUrl: string | null = PPC_CANDIDATES_URL

    while (nextUrl && !visitedPages.has(nextUrl)) {
      visitedPages.add(nextUrl)
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: PPC_TIMEOUT_MS })
      await page.waitForSelector('a[href*="/candidate/"] h3', { timeout: PPC_TIMEOUT_MS })

      const payload = await page.evaluate(PPC_LISTING_EVAL) as { cards: PpcCandidateCard[]; nextHref: string | null }

      payload.cards.forEach((card) => {
        if (!cardsByUrl.has(card.candidateUrl)) {
          cardsByUrl.set(card.candidateUrl, card)
        }
      })
      nextUrl = payload.nextHref
    }
  } finally {
    await page.close().catch(() => null)
    await browser.close().catch(() => null)
  }

  return Array.from(cardsByUrl.values()).sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function scrapeAndSyncPpcCandidates(): Promise<PpcCandidateImportSummary> {
  const importedAt = new Date().toISOString()
  const cards = await scrapePpcCandidateCards()

  const party = await prisma.politicalParty.upsert({
    where: {
      jurisdiction_slug: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        slug: PPC_PARTY_SLUG,
      },
    },
    create: {
      jurisdiction: PoliticalJurisdiction.FEDERAL,
      slug: PPC_PARTY_SLUG,
      name: PPC_PARTY_NAME,
      shortName: PPC_PARTY_SHORT_NAME,
      metadata: {
        source: 'ppc_candidates',
      },
    },
    update: {
      name: PPC_PARTY_NAME,
      shortName: PPC_PARTY_SHORT_NAME,
    },
    select: { id: true },
  })

  const districts = await prisma.electoralDistrict.findMany({
    select: {
      code: true,
      name: true,
      slug: true,
      provinceCode: true,
    },
  })
  const { byName, bySlug } = buildDistrictMaps(districts)

  let matchedDistricts = 0
  let politiciansCreated = 0
  let politiciansUpdated = 0
  const unmatchedSample: ScrapeSummaryItem[] = []

  for (const card of cards) {
    const provinceCode = provinceCodeFromName(card.provinceName)
    if (!provinceCode) {
      if (unmatchedSample.length < 25) {
        unmatchedSample.push({
          displayName: card.displayName,
          ridingName: card.ridingName,
          provinceName: card.provinceName,
          reason: 'province_not_mapped',
        })
      }
      continue
    }

    const district = byName.get(`${provinceCode}:${normalizeMatchText(card.ridingName)}`)
      ?? bySlug.get(`${provinceCode}:${slugifyCommunityName(card.ridingName)}`)

    if (!district) {
      if (unmatchedSample.length < 25) {
        unmatchedSample.push({
          displayName: card.displayName,
          ridingName: card.ridingName,
          provinceName: card.provinceName,
          reason: 'district_not_found',
        })
      }
      continue
    }

    matchedDistricts += 1
    const nameParts = splitName(card.displayName)
    const existing = await prisma.politician.findUnique({
      where: {
        jurisdiction_sourceSystem_sourcePersonId: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          sourceSystem: 'ppc',
          sourcePersonId: card.candidateSlug,
        },
      },
      select: {
        id: true,
        metadata: true,
      },
    })

    const metadata = {
      ...jsonObject(existing?.metadata),
      scrape: {
        ...jsonObject(jsonObject(existing?.metadata).scrape as Prisma.JsonValue | null),
        lastScrapeAt: importedAt,
      },
      ppc: {
        ...jsonObject(jsonObject(existing?.metadata).ppc as Prisma.JsonValue | null),
        lastScrapeAt: importedAt,
        sourceUrl: PPC_CANDIDATES_URL,
        candidateUrl: card.candidateUrl,
        ridingName: card.ridingName,
        provinceName: card.provinceName,
        photoUrl: card.photoUrl,
        backgroundImageUrl: card.backgroundImageUrl,
      },
    } satisfies Record<string, unknown>

    await prisma.politician.upsert({
      where: {
        jurisdiction_sourceSystem_sourcePersonId: {
          jurisdiction: PoliticalJurisdiction.FEDERAL,
          sourceSystem: 'ppc',
          sourcePersonId: card.candidateSlug,
        },
      },
      create: {
        jurisdiction: PoliticalJurisdiction.FEDERAL,
        slug: buildPoliticianSlug(card.displayName, card.candidateSlug),
        displayName: card.displayName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        officeType: PoliticalOfficeType.MP,
        provinceCode: district.provinceCode,
        communitySlug: district.slug,
        electoralDistrictCode: district.code,
        partyId: party.id,
        sourceSystem: 'ppc',
        sourcePersonId: card.candidateSlug,
        metadata: metadata as Prisma.InputJsonValue,
      },
      update: {
        slug: buildPoliticianSlug(card.displayName, card.candidateSlug),
        displayName: card.displayName,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        officeType: PoliticalOfficeType.MP,
        provinceCode: district.provinceCode,
        communitySlug: district.slug,
        electoralDistrictCode: district.code,
        partyId: party.id,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })

    if (existing) {
      politiciansUpdated += 1
    } else {
      politiciansCreated += 1
    }
  }

  return {
    importedAt,
    sourceUrl: PPC_CANDIDATES_URL,
    cardsFound: cards.length,
    matchedDistricts,
    politiciansCreated,
    politiciansUpdated,
    unmatchedCards: cards.length - matchedDistricts,
    unmatchedSample,
  }
}