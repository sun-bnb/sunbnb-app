'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export type RestaurantSubTab = 'settings' | 'tables' | 'menu' | 'reservations'

export function RestaurantSubNav({
  restaurantId,
  active,
}: {
  restaurantId: string
  active: RestaurantSubTab
}) {
  const router = useRouter()
  const t = useTranslations('Restaurant')

  const tabs: Array<{ key: RestaurantSubTab; label: string; href: string }> = [
    { key: 'reservations', label: t('subNavReservations'), href: `/restaurants/${restaurantId}/reservations` },
    { key: 'tables', label: t('subNavTables'), href: `/restaurants/${restaurantId}/tables` },
    { key: 'menu', label: t('subNavMenu'), href: `/restaurants/${restaurantId}/menu` },
    { key: 'settings', label: t('subNavSettings'), href: `/restaurants/${restaurantId}` },
  ]

  return (
    <nav className="flex gap-1 border-b border-gray-200 bg-white px-2">
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => router.push(tab.href)}
            className={`px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'text-gray-900 font-medium border-b-2 border-gray-900 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
