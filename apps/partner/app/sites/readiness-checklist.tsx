'use client'

import React, { useState } from 'react'
import { SiteProps } from '@/types/shared'

interface ReadinessItem {
  key: string
  label: string
  met: boolean
  tab: string
  hint: string
}

function computeMissing(site: SiteProps): ReadinessItem[] {
  const isPaid = site.type === 'paid'
  const activeItems = site.inventoryItems?.filter(i => i.status === 'active') ?? []

  const all: ReadinessItem[] = [
    {
      key: 'name',
      label: 'Site name',
      met: !!site.name && site.name.trim().length > 0,
      tab: 'general',
      hint: 'Set a name for your site',
    },
    {
      key: 'location',
      label: 'Location',
      met: !!site.locationLat && !!site.locationLng && site.locationLat !== '0' && site.locationLng !== '0',
      tab: 'general',
      hint: 'Set the map location so customers can find you',
    },
    {
      key: 'working-hours',
      label: 'Working hours',
      met: (site.workingHours?.length ?? 0) > 0,
      tab: 'general',
      hint: 'Set at least one day of working hours',
    },
    {
      key: 'inventory',
      label: 'Active inventory',
      met: activeItems.length > 0,
      tab: 'inventory',
      hint: 'Add sunbeds and set them to active',
    },
    {
      key: 'image',
      label: 'Cover image',
      met: !!site.image,
      tab: 'content',
      hint: 'Upload a cover photo for your site listing',
    },
  ]

  if (isPaid) {
    all.splice(2, 0, {
      key: 'price',
      label: 'Base price',
      met: !!site.price && site.price > 0,
      tab: 'general',
      hint: 'Set a base price for sunbed reservations',
    })
    all.splice(3, 0, {
      key: 'vat',
      label: 'VAT rate',
      met: site.vat != null && site.vat >= 0,
      tab: 'general',
      hint: 'Set the VAT rate for invoicing',
    })
  }

  // Mollie onboarding required when any service uses integrated payments
  const hasIntegratedPayments = isPaid
    || site.orderPaymentType === 'paid'
    || site.rentalPaymentType === 'paid'

  if (hasIntegratedPayments) {
    const mollieReady = site.hasMollieToken && site.mollieOnboardingStatus === 'completed'
    all.push({
      key: 'mollie',
      label: 'Payment setup',
      met: !!mollieReady,
      tab: '', // navigates to /account/mollie, handled specially
      hint: !site.hasMollieToken
        ? 'Connect your Mollie account to accept payments'
        : 'Complete Mollie onboarding to accept payments',
    })
  }

  return all.filter(item => !item.met)
}

export default function ReadinessChecklist({ site, onNavigate, className }: {
  site: SiteProps
  onNavigate: (path: string) => void
  className?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const missing = computeMissing(site)

  if (missing.length === 0) return null

  return (
    <div className={className ?? 'mx-0 mt-3 mb-1'}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-200 hover:bg-amber-100/70 transition-colors ${collapsed ? 'rounded-lg' : 'rounded-t-lg'}`}
      >
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-sm font-medium text-amber-800">
            {missing.length} {missing.length === 1 ? 'thing' : 'things'} to complete before going live
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-amber-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && (
        <div className="border border-t-0 border-amber-200 rounded-b-lg bg-white divide-y divide-gray-100">
          {missing.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.tab || '/account/mollie')}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-amber-50/50 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="12" cy="12" r="9" />
              </svg>
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-800 font-medium">{item.label}</span>
                <span className="text-xs text-gray-400 ml-2">{item.hint}</span>
              </div>
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
