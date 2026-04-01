export const CANADA_SALES_TAX_PRESET_KEY = '__preset'

export type CanadaSalesTaxPreset = 'canada_current' | 'gst_5' | 'none' | 'custom'

export type CanadaSalesTaxRegion = {
  code: string
  name: string
  defaultRatePct: number
  label: string
}

export const CURRENT_CANADA_SALES_TAX_AS_OF = '2026-03-31'

export const CURRENT_CANADA_SALES_TAX_REGIONS: readonly CanadaSalesTaxRegion[] = [
  { code: 'AB', name: 'Alberta', defaultRatePct: 5, label: 'GST only — 5%' },
  { code: 'BC', name: 'British Columbia', defaultRatePct: 12, label: 'GST 5% + PST 7% — 12%' },
  { code: 'MB', name: 'Manitoba', defaultRatePct: 12, label: 'GST 5% + RST 7% — 12%' },
  { code: 'NB', name: 'New Brunswick', defaultRatePct: 15, label: 'HST — 15%' },
  { code: 'NL', name: 'Newfoundland and Labrador', defaultRatePct: 15, label: 'HST — 15%' },
  { code: 'NS', name: 'Nova Scotia', defaultRatePct: 14, label: 'HST — 14%' },
  { code: 'NT', name: 'Northwest Territories', defaultRatePct: 5, label: 'GST only — 5%' },
  { code: 'NU', name: 'Nunavut', defaultRatePct: 5, label: 'GST only — 5%' },
  { code: 'ON', name: 'Ontario', defaultRatePct: 13, label: 'HST — 13%' },
  { code: 'PE', name: 'Prince Edward Island', defaultRatePct: 15, label: 'HST — 15%' },
  { code: 'QC', name: 'Quebec', defaultRatePct: 14.975, label: 'GST 5% + QST 9.975% — 14.975%' },
  { code: 'SK', name: 'Saskatchewan', defaultRatePct: 11, label: 'GST 5% + PST 6% — 11%' },
  { code: 'YT', name: 'Yukon', defaultRatePct: 5, label: 'GST only — 5%' },
] as const

const REGION_CODE_SET = new Set(CURRENT_CANADA_SALES_TAX_REGIONS.map((region) => region.code))
const PRESET_SET = new Set<CanadaSalesTaxPreset>(['canada_current', 'gst_5', 'none', 'custom'])

function roundRatePct(value: number) {
  return Math.round(value * 1000) / 1000
}

function ratePctToString(value: number) {
  const rounded = roundRatePct(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function parseRatePct(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return roundRatePct(value)
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return roundRatePct(parsed)
  }
  return null
}

function getRegionRateMap() {
  const byCode = new Map<string, number>()
  for (const region of CURRENT_CANADA_SALES_TAX_REGIONS) {
    byCode.set(region.code, roundRatePct(region.defaultRatePct))
  }
  return byCode
}

const CURRENT_REGION_RATE_MAP = getRegionRateMap()

function allRegionRatesMatch(targetRates: Record<string, string>, expectedByCode: Map<string, number>) {
  for (const region of CURRENT_CANADA_SALES_TAX_REGIONS) {
    const parsed = parseRatePct(targetRates[region.code])
    const expected = expectedByCode.get(region.code) ?? null
    if (parsed == null || expected == null || Math.abs(parsed - expected) > 0.0001) return false
  }
  return true
}

function allRegionRatesEqual(targetRates: Record<string, string>, expectedRate: number) {
  for (const region of CURRENT_CANADA_SALES_TAX_REGIONS) {
    const parsed = parseRatePct(targetRates[region.code])
    if (parsed == null || Math.abs(parsed - expectedRate) > 0.0001) return false
  }
  return true
}

function readKnownRegionRates(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const typed = raw as Record<string, unknown>
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(typed)) {
    const normalizedKey = key.trim().toUpperCase()
    if (!normalizedKey || (!REGION_CODE_SET.has(normalizedKey) && normalizedKey !== CANADA_SALES_TAX_PRESET_KEY.toUpperCase())) continue
    const normalizedValue = typeof value === 'string' ? value.trim() : value
    if (normalizedKey === CANADA_SALES_TAX_PRESET_KEY.toUpperCase()) {
      if (typeof normalizedValue === 'string' && PRESET_SET.has(normalizedValue as CanadaSalesTaxPreset)) {
        next[CANADA_SALES_TAX_PRESET_KEY] = normalizedValue
      }
      continue
    }
    const ratePct = parseRatePct(normalizedValue)
    if (ratePct == null) continue
    next[normalizedKey] = ratePctToString(ratePct)
  }
  return next
}

export function buildCanadaSalesTaxCatalogResponse() {
  return {
    asOf: CURRENT_CANADA_SALES_TAX_AS_OF,
    regions: CURRENT_CANADA_SALES_TAX_REGIONS.map((region) => ({
      code: region.code,
      name: region.name,
      defaultRatePct: region.defaultRatePct,
      options: [{ label: region.label, ratePct: region.defaultRatePct }],
    })),
  }
}

export function buildCanadaSalesTaxRatesByPreset(preset: Exclude<CanadaSalesTaxPreset, 'custom'>): Record<string, string> {
  const rates: Record<string, string> = {
    [CANADA_SALES_TAX_PRESET_KEY]: preset,
  }

  for (const region of CURRENT_CANADA_SALES_TAX_REGIONS) {
    let ratePct = region.defaultRatePct
    if (preset === 'gst_5') ratePct = 5
    if (preset === 'none') ratePct = 0
    rates[region.code] = ratePctToString(ratePct)
  }

  return rates
}

export function inferCanadaSalesTaxPreset(raw: unknown): CanadaSalesTaxPreset {
  const normalized = readKnownRegionRates(raw)
  const explicitPreset = normalized[CANADA_SALES_TAX_PRESET_KEY]
  if (explicitPreset === 'canada_current' || explicitPreset === 'gst_5' || explicitPreset === 'none' || explicitPreset === 'custom') {
    return explicitPreset
  }

  const hasAnyRegionRate = CURRENT_CANADA_SALES_TAX_REGIONS.some((region) => Object.prototype.hasOwnProperty.call(normalized, region.code))
  if (!hasAnyRegionRate) return 'canada_current'
  if (allRegionRatesMatch(normalized, CURRENT_REGION_RATE_MAP)) return 'canada_current'
  if (allRegionRatesEqual(normalized, 0)) return 'none'
  // Legacy bug fallback: historical product settings often saved GST-only values
  // when the editor should have applied province-specific current rates.
  if (allRegionRatesEqual(normalized, 5)) return 'canada_current'
  return 'custom'
}

export function normalizeCanadaSalesTaxRatesByRegion(
  raw: unknown,
  options?: {
    fallbackPreset?: Exclude<CanadaSalesTaxPreset, 'custom'>
  },
): Record<string, string> {
  const fallbackPreset = options?.fallbackPreset ?? 'canada_current'
  const normalized = readKnownRegionRates(raw)
  const inferredPreset = inferCanadaSalesTaxPreset(normalized)

  if (inferredPreset !== 'custom') {
    return buildCanadaSalesTaxRatesByPreset(inferredPreset)
  }

  const next: Record<string, string> = {
    [CANADA_SALES_TAX_PRESET_KEY]: 'custom',
  }
  for (const region of CURRENT_CANADA_SALES_TAX_REGIONS) {
    const parsed = parseRatePct(normalized[region.code])
    next[region.code] = parsed == null ? ratePctToString(region.defaultRatePct) : ratePctToString(parsed)
  }
  if (!CURRENT_CANADA_SALES_TAX_REGIONS.some((region) => parseRatePct(normalized[region.code]) != null)) {
    return buildCanadaSalesTaxRatesByPreset(fallbackPreset)
  }
  return next
}
