export type MarketCartItem = {
  productId: string
  variantId?: string | null
  selectedAttributes?: Record<string, string> | null
  quantity: number
}

export const MARKET_CART_KEY = 'civil_market_cart'

export function getMarketCartItemKey(item: Pick<MarketCartItem, 'productId' | 'variantId'>) {
  return `${item.productId}::${item.variantId?.trim() || ''}`
}

function normalizeSelectedAttributes(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || '').trim()
    const entryValue = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !entryValue) continue
    out[key] = entryValue
  }
  return Object.keys(out).length ? out : null
}

export function readMarketCart(): MarketCartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MARKET_CART_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const out: MarketCartItem[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const typed = entry as Record<string, unknown>
      const productId = typed.productId
      const variantId = typeof typed.variantId === 'string' && typed.variantId.trim() ? typed.variantId.trim() : null
      const selectedAttributes = normalizeSelectedAttributes(typed.selectedAttributes)
      const quantity = typed.quantity
      if (typeof productId === 'string' && typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
        out.push({ productId, variantId, selectedAttributes, quantity })
      }
    }
    return out
  } catch {
    return []
  }
}

export function writeMarketCart(items: MarketCartItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MARKET_CART_KEY, JSON.stringify(items))
}

export function setMarketCartQuantity(
  items: MarketCartItem[],
  target: Pick<MarketCartItem, 'productId' | 'variantId' | 'selectedAttributes'>,
  quantity: number,
): MarketCartItem[] {
  const numericQuantity = Number.isFinite(quantity) ? quantity : 0
  const safeQuantity = Math.max(0, Math.min(99, Math.floor(numericQuantity)))
  const next: MarketCartItem[] = []
  let touched = false
  const targetKey = getMarketCartItemKey(target)

  for (const item of items) {
    if (getMarketCartItemKey(item) !== targetKey) {
      next.push(item)
      continue
    }

    touched = true
    if (safeQuantity > 0) {
      next.push({
        productId: target.productId,
        variantId: target.variantId?.trim() || null,
        selectedAttributes: normalizeSelectedAttributes(target.selectedAttributes),
        quantity: safeQuantity,
      })
    }
  }

  if (!touched && safeQuantity > 0) {
    next.push({
      productId: target.productId,
      variantId: target.variantId?.trim() || null,
      selectedAttributes: normalizeSelectedAttributes(target.selectedAttributes),
      quantity: safeQuantity,
    })
  }
  return next
}

export function addMarketCartItem(
  items: MarketCartItem[],
  target: Pick<MarketCartItem, 'productId' | 'variantId' | 'selectedAttributes'>,
  delta = 1,
): MarketCartItem[] {
  const targetKey = getMarketCartItemKey(target)
  const current = items.find((item) => getMarketCartItemKey(item) === targetKey)?.quantity ?? 0
  return setMarketCartQuantity(items, target, current + delta)
}
