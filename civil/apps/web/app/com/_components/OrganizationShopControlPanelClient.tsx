'use client'

import Link from 'next/link'
import {
  HiOutlineShoppingBag,
  HiOutlineRectangleStack,
  HiOutlineClipboardDocumentList,
  HiOutlineCog6Tooth,
} from 'react-icons/hi2'

type PanelItem = {
  label: string
  description: string
  href: string
  icon: React.ComponentType<{ className?: string }>
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

  const items: PanelItem[] = [
    {
      label: 'Products',
      description: 'Create drafts, publish products, and manage pricing.',
      href: `${base}/products`,
      icon: HiOutlineShoppingBag,
    },
    {
      label: 'Catalogs',
      description: 'Add and reorder storefront sections.',
      href: `${base}/catalogs`,
      icon: HiOutlineRectangleStack,
    },
    {
      label: 'Orders',
      description: 'Review and manage customer orders.',
      href: `${base}/orders`,
      icon: HiOutlineClipboardDocumentList,
    },
    {
      label: 'Shop Settings',
      description: 'Shipping defaults and Stripe payouts.',
      href: `${base}/settings`,
      icon: HiOutlineCog6Tooth,
    },
  ]

  return (
    <section className="surface-card p-4 shadow-subtle">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.label} href={item.href} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:bg-slate-50">
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <Icon className="h-5 w-5 text-slate-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
