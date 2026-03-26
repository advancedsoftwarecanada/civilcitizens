export type PartySummary = {
  slug: string
  name: string
  shortName: string | null
}

export type PartyVisual = {
  code: string
  icon: string
  variant: 'cpc' | 'lpc' | 'ppc' | 'ndp' | 'gpc' | 'bq' | 'neutral'
  name: string
  mapFillColor: string
  mapLineColor: string
  mapFillOpacity: number
}

export function resolveJurisdictionLabel(jurisdiction: 'federal' | 'provincial' | 'municipal' | undefined) {
  if (jurisdiction === 'provincial') return 'Provincial'
  if (jurisdiction === 'municipal') return 'Municipal'
  return 'Federal'
}

export function resolvePartyHref(
  party: PartySummary | null | undefined,
  jurisdiction: 'federal' | 'provincial' | 'municipal' | undefined,
) {
  if (!party?.slug?.trim()) return null
  if (jurisdiction === 'federal' || !jurisdiction) {
    return `/politicians/federal/${encodeURIComponent(party.slug)}`
  }
  return null
}

function buildFallbackCode(value: string) {
  const compact = value
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return compact.slice(0, 4) || 'POL'
}

export function resolvePartyVisual(party: PartySummary | null | undefined): PartyVisual | null {
  if (!party) return null

  const slug = party.slug.trim().toLowerCase()

  if (slug === 'conservative-party-of-canada') {
    return {
      code: 'CPC',
      icon: 'C',
      variant: 'cpc',
      name: party.name,
      mapFillColor: '#2563eb',
      mapLineColor: '#1e40af',
      mapFillOpacity: 0.16,
    }
  }

  if (slug === 'liberal-party-of-canada') {
    return {
      code: 'LPC',
      icon: 'L',
      variant: 'lpc',
      name: party.name,
      mapFillColor: '#d52b1e',
      mapLineColor: '#991b1b',
      mapFillOpacity: 0.16,
    }
  }

  if (slug === 'peoples-party-of-canada') {
    return {
      code: 'PPC',
      icon: 'P',
      variant: 'ppc',
      name: party.name,
      mapFillColor: '#6d28d9',
      mapLineColor: '#5b21b6',
      mapFillOpacity: 0.16,
    }
  }

  if (slug === 'new-democratic-party') {
    return {
      code: 'NDP',
      icon: 'N',
      variant: 'ndp',
      name: party.name,
      mapFillColor: '#ea580c',
      mapLineColor: '#c2410c',
      mapFillOpacity: 0.16,
    }
  }

  if (slug === 'green-party-of-canada') {
    return {
      code: 'GPC',
      icon: 'G',
      variant: 'gpc',
      name: party.name,
      mapFillColor: '#16a34a',
      mapLineColor: '#166534',
      mapFillOpacity: 0.16,
    }
  }

  if (slug === 'bloc-quebecois') {
    return {
      code: 'BQ',
      icon: 'B',
      variant: 'bq',
      name: party.name,
      mapFillColor: '#0ea5e9',
      mapLineColor: '#0369a1',
      mapFillOpacity: 0.16,
    }
  }

  const code = buildFallbackCode(party.shortName?.trim() || party.name)
  return {
    code,
    icon: code[0] ?? 'P',
    variant: 'neutral',
    name: party.name,
    mapFillColor: '#94a3b8',
    mapLineColor: '#64748b',
    mapFillOpacity: 0.14,
  }
}
