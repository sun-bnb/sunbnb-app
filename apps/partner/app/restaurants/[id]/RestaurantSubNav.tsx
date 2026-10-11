'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export type RestaurantSubTab = 'general' | 'tables' | 'menu' | 'reservations' | 'accounting'

export function RestaurantSubNav({
  restaurantId,
  active,
}: {
  restaurantId: string
  active: RestaurantSubTab
}) {
  const router = useRouter()
  const t = useTranslations('Restaurant')

  // Order mirrors the site-management tabs (General → Inventory → Products → …)
  // so the menu structure logic is consistent across corresponding sections:
  // General ↔ site General, Tables ↔ Inventory, Menu ↔ Products, Accounting ↔
  // site Accounting. Reservations has no site-tab analog (site puts live ops
  // in separate routes), so it trails; Accounting comes last (mirrors site tab order).
  const tabs: Array<{ key: RestaurantSubTab; label: string; href: string }> = [
    { key: 'general', label: t('subNavGeneral'), href: `/restaurants/${restaurantId}` },
    { key: 'tables', label: t('subNavTables'), href: `/restaurants/${restaurantId}/tables` },
    { key: 'menu', label: t('subNavMenu'), href: `/restaurants/${restaurantId}/menu` },
    { key: 'reservations', label: t('subNavReservations'), href: `/restaurants/${restaurantId}/reservations` },
    { key: 'accounting', label: t('subNavAccounting'), href: `/restaurants/${restaurantId}/accounting` },
  ]

  return (
    // On a phone the five tabs don't fit in 360px — the strip scrolls
    // horizontally inside itself (scrollbar hidden) instead of overflowing the page.
    // The baseline is an inset shadow, not border-b + -mb-px on the active tab:
    // overflow-x-auto clips y too, so a -1px overlap would add a stray scroll.
    <nav className="flex gap-1 overflow-x-auto bg-white shadow-[inset_0_-1px_0_var(--color-gray-200)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => router.push(tab.href)}
            aria-current={isActive ? 'page' : undefined}
            className={`min-h-10 shrink-0 whitespace-nowrap px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'text-gray-900 font-medium border-b-2 border-gray-900'
                : 'border-b-2 border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
