export type MarketCartItem = { productId: string; quantity: number }

export const MARKET_CART_KEY = 'civil_market_cart'

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
      const quantity = typed.quantity
      if (typeof productId === 'string' && typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
        out.push({ productId, quantity })
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

export function setMarketCartQuantity(items: MarketCartItem[], productId: string, quantity: number): MarketCartItem[] {
  const numericQuantity = Number.isFinite(quantity) ? quantity : 0
  const safeQuantity = Math.max(0, Math.min(99, Math.floor(numericQuantity)))
  const next: MarketCartItem[] = []
  let touched = false

  for (const item of items) {
    if (item.productId !== productId) {
      next.push(item)
      continue
    }

    touched = true
    if (safeQuantity > 0) {
      next.push({ productId, quantity: safeQuantity })
    }
  }

  if (!touched && safeQuantity > 0) next.push({ productId, quantity: safeQuantity })
  return next
}

export function addMarketCartItem(items: MarketCartItem[], productId: string, delta = 1): MarketCartItem[] {
  const current = items.find((item) => item.productId === productId)?.quantity ?? 0
  return setMarketCartQuantity(items, productId, current + delta)
}
