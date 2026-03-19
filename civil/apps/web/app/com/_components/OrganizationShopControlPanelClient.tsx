'use client'

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import {
  HiOutlineShoppingBag,
  HiOutlineRectangleStack,
  HiOutlineArchiveBox,
  HiOutlineClipboardDocumentList,
  HiOutlineCog6Tooth,
} from 'react-icons/hi2'
import { buildApiUrl } from '../../_lib/api'
import { getStoredToken } from '../../_lib/tokenStorage'

type PanelItem = {
  label: string
  description: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  requiresWarehouse?: boolean
}

export default function OrganizationShopControlPanelClient({
  province,
  municipality,
  organization,
}: {
  province: string
  municipality: string
  organization: string
}) {
  const base = `/com/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/shop/manage`
  const shopPath = useMemo(
    () => `/communities/${encodeURIComponent(province)}/${encodeURIComponent(municipality)}/orgs/${encodeURIComponent(organization)}/shop`,
    [municipality, organization, province],
  )
  const [hasWarehouse, setHasWarehouse] = useState<boolean | null>(null)

  const items: PanelItem[] = [
    {
      label: 'Products',
      description: 'Create drafts, publish products, and manage pricing.',
      href: `${base}/products`,
      icon: HiOutlineShoppingBag,
      requiresWarehouse: true,
    },
    {
      label: 'Catalogs',
      description: 'Add and reorder storefront sections.',
      href: `${base}/catalogs`,
      icon: HiOutlineRectangleStack,
      requiresWarehouse: true,
    },
    {
      label: 'Warehouses',
      description: 'Define warehouse locations for inventory and fulfillment.',
      href: `${base}/warehouses`,
      icon: HiOutlineArchiveBox,
    },
    {
      label: 'Orders',
      description: 'Review and manage customer orders.',
      href: `${base}/orders`,
      icon: HiOutlineClipboardDocumentList,
      requiresWarehouse: true,
    },
    {
      label: 'Shop Settings',
      description: 'Shipping defaults and Stripe payouts.',
      href: `${base}/settings`,
      icon: HiOutlineCog6Tooth,
    },
  ]

  useEffect(() => {
    let cancelled = false

    const loadWarehouseState = async () => {
      try {
        const token = getStoredToken()
        const res = await fetch(buildApiUrl(shopPath), {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        })
        if (!res.ok) {
          if (!cancelled) setHasWarehouse(null)
          return
        }

        const payload = (await res.json().catch(() => null)) as { warehouses?: Array<unknown> } | null
        if (!cancelled) {
          setHasWarehouse(Array.isArray(payload?.warehouses) && payload.warehouses.length > 0)
        }
      } catch {
        if (!cancelled) setHasWarehouse(null)
      }
    }

    void loadWarehouseState()

    return () => {
      cancelled = true
    }
  }, [shopPath])

  return (
    <section className="surface-card p-4 shadow-subtle">
      {hasWarehouse === false ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Add a warehouse first to unlock Products, Catalogs, and Orders.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon
          const disabled = item.requiresWarehouse && hasWarehouse === false

          return (
            <Link
              key={item.label}
              href={disabled ? '#' : item.href}
              aria-disabled={disabled}
              onClick={disabled ? (event) => event.preventDefault() : undefined}
              className={clsx(
                'rounded-2xl border bg-white p-4 transition',
                disabled ? 'cursor-not-allowed border-slate-200 text-slate-400 opacity-60' : 'border-slate-200 hover:bg-slate-50',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={clsx('rounded-xl border p-2', disabled ? 'border-slate-200 bg-slate-100' : 'border-slate-200 bg-slate-50')}>
                  <Icon className={clsx('h-5 w-5', disabled ? 'text-slate-400' : 'text-slate-700')} />
                </div>
                <div className="min-w-0">
                  <p className={clsx('text-sm font-semibold', disabled ? 'text-slate-500' : 'text-slate-900')}>{item.label}</p>
                  <p className={clsx('mt-1 text-xs', disabled ? 'text-slate-400' : 'text-slate-500')}>
                    {disabled ? `${item.description} Add a warehouse first.` : item.description}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
