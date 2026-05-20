'use client'

import React from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import Divider from '@mui/material/Divider'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import PaymentsIcon from '@mui/icons-material/Payments'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import { WizardData, WizardFeeData } from './create-site-wizard'

const WEEK_DAYS = [
  { key: '1', short: 'Mon', label: 'Monday' },
  { key: '2', short: 'Tue', label: 'Tuesday' },
  { key: '3', short: 'Wed', label: 'Wednesday' },
  { key: '4', short: 'Thu', label: 'Thursday' },
  { key: '5', short: 'Fri', label: 'Friday' },
  { key: '6', short: 'Sat', label: 'Saturday' },
  { key: '7', short: 'Sun', label: 'Sunday' },
]

function round(amount: number) {
  return Math.round(amount * 100) / 100
}

const TIER_ORDER = ['STARTER', 'PRO', 'BUSINESS'] as const
const TIER_LABELS: Record<string, string> = { STARTER: 'Starter', PRO: 'Pro', BUSINESS: 'Business' }
const TIER_FEES: Record<string, string> = { STARTER: '5%', PRO: '2%', BUSINESS: '0%' }

function WizardPriceBreakdown({
  price,
  vat: vatStr,
  serviceFee,
  tier,
}: {
  price: string
  vat: string
  serviceFee?: WizardFeeData | null
  tier: string
}) {
  const priceNum = Number(price)
  if (!priceNum || priceNum <= 0) return null

  const vatRate = Number(vatStr) || 0

  const feeAmount = serviceFee
    ? serviceFee.chargeType === 'fixed'
      ? (serviceFee.feeAmount ?? 0)
      : round(((serviceFee.percentage ?? 0) / 100) * priceNum)
    : 0

  const partnerGross = round(priceNum - feeAmount)
  const partnerBase = vatRate > 0 ? round(partnerGross / (1 + vatRate / 100)) : partnerGross
  const partnerVat = round(partnerGross - partnerBase)

  // Find next tier with a better fee
  const tierIdx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number])
  const nextTier = tierIdx >= 0 && tierIdx < TIER_ORDER.length - 1 ? TIER_ORDER[tierIdx + 1] : null

  return (
    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs">
      <div className="flex justify-between text-gray-500 mb-1">
        <span>Customer pays</span>
        <span>{priceNum.toFixed(2)} &euro;</span>
      </div>
      {feeAmount > 0 && (
        <div className="flex justify-between text-gray-500 mb-1">
          <span>
            Service fee
            {serviceFee?.chargeType === 'fixed' ? '' : ` (${(serviceFee?.percentage ?? 0).toFixed(0)}%)`}
          </span>
          <span className="text-red-500">&minus;{feeAmount.toFixed(2)} &euro;</span>
        </div>
      )}
      {feeAmount > 0 && nextTier && !serviceFee?.overridden && (
        <div className="text-[11px] text-indigo-500 mb-1">
          Upgrade to {TIER_LABELS[nextTier]} for {TIER_FEES[nextTier]} service fee
        </div>
      )}
      <div className="border-t border-gray-200 my-1.5" />
      <div className="flex justify-between font-medium text-gray-800 mb-1">
        <span>You receive</span>
        <span>{partnerGross.toFixed(2)} &euro;</span>
      </div>
      {vatRate > 0 && (
        <div className="flex justify-between text-gray-400">
          <span>incl. VAT {vatRate}%</span>
          <span>{partnerVat.toFixed(2)} &euro;</span>
        </div>
      )}
    </div>
  )
}

export default function StepDetails({
  data,
  update,
  tier,
  serviceFee,
  features = null,
}: {
  data: WizardData
  update: (p: Partial<WizardData>) => void
  tier: string
  serviceFee?: WizardFeeData | null
  features?: Record<string, boolean> | null
}) {

  const isPaid = data.type === 'paid'
  const canUseAvailabilityOnly = features?.OFF_PLATFORM_BILLING ?? false

  const hoursForDay = (dayKey: string) =>
    data.workingHours
      .map((wh, idx) => ({ ...wh, idx }))
      .filter(wh => wh.day === dayKey)

  const toggleDay = (dayKey: string) => {
    const existing = hoursForDay(dayKey)
    if (existing.length > 0) {
      // Remove all entries for this day
      update({
        workingHours: data.workingHours.filter(wh => wh.day !== dayKey),
      })
    } else {
      // Add a default slot
      update({
        workingHours: [
          ...data.workingHours,
          { day: dayKey, openTime: '09:00', closeTime: '18:00' },
        ],
      })
    }
  }

  const updateSlot = (index: number, field: 'openTime' | 'closeTime', value: string) => {
    const next = [...data.workingHours]
    next[index] = { day: next[index]!.day, openTime: next[index]!.openTime, closeTime: next[index]!.closeTime, [field]: value }
    update({ workingHours: next })
  }

  const addSlot = (dayKey: string) => {
    update({
      workingHours: [
        ...data.workingHours,
        { day: dayKey, openTime: '09:00', closeTime: '18:00' },
      ],
    })
  }

  const removeSlot = (index: number) => {
    update({
      workingHours: data.workingHours.filter((_, i) => i !== index),
    })
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Site details</h2>
      <p className="text-sm text-gray-500 mb-5">
        Name your site, choose how reservations are handled, and set when customers can book.
        All settings can be changed later.
      </p>

      {/* Site name */}
      <TextField
        fullWidth
        required
        label="Site name"
        value={data.name}
        onChange={e => update({ name: e.target.value })}
        helperText="The name your customers will see"
        sx={{ mb: 4 }}
      />

      <Divider sx={{ mb: 3 }} />

      {/* Billing type */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Billing type</h3>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => update({ type: 'paid' })}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              isPaid
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <PaymentsIcon fontSize="small" className={isPaid ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`font-medium text-sm ${isPaid ? 'text-blue-700' : 'text-gray-700'}`}>
                Integrated payments
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Customers pay when booking. Payment is collected and settled through the platform.
            </p>
          </button>
          <button
            type="button"
            disabled={!canUseAvailabilityOnly}
            onClick={() => update({ type: 'unpaid', price: '' })}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
              !canUseAvailabilityOnly
                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                : !isPaid
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <EventAvailableIcon fontSize="small" className={!canUseAvailabilityOnly ? 'text-gray-400' : !isPaid ? 'text-blue-600' : 'text-gray-400'} />
              <span className={`font-medium text-sm ${!canUseAvailabilityOnly ? 'text-gray-400' : !isPaid ? 'text-blue-700' : 'text-gray-700'}`}>
                Off-platform billing
              </span>
            </div>
            <p className="text-xs text-gray-500">
              No payment collected on the platform. Ideal when billing is handled externally, e.g. hotel guests.
            </p>
            {!canUseAvailabilityOnly && (
              <p className="text-xs text-amber-600 mt-1.5 font-medium">Pro or Business plan required</p>
            )}
          </button>
        </div>
      </div>

      {/* Pricing — only for paid */}
      {isPaid && (
        <>
          <div className="flex gap-3 mb-4">
            <TextField
              fullWidth
              label="Base price (€)"
              type="number"
              value={data.price}
              onChange={e => update({ price: e.target.value })}
              placeholder="e.g. 15"
              helperText="Base price shown on your site page"
            />
            <TextField
              sx={{ width: 180, flexShrink: 0 }}
              required
              label="Tax rate (%)"
              type="number"
              value={data.vat}
              onChange={e => update({ vat: e.target.value })}
              placeholder="e.g. 21"
              helperText="Applied to all sales"
            />
          </div>
          <WizardPriceBreakdown
            price={data.price}
            vat={data.vat}
            serviceFee={serviceFee}
            tier={tier}
          />
        </>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Booking hours */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-1">Booking hours</h3>
        <p className="text-xs text-gray-500 mb-3">
          Set when sunbeds are available for reservation each day. Toggle a day on to enable bookings.
        </p>

        <div className="flex flex-col gap-1">
          {WEEK_DAYS.map(day => {
            const slots = hoursForDay(day.key)
            const isActive = slots.length > 0

            return (
              <div
                key={day.key}
                className={`rounded-lg border px-3 py-2 transition-all ${
                  isActive ? 'border-gray-200 bg-white' : 'border-transparent bg-gray-50'
                }`}
              >
                {/* Day toggle row */}
                <div className="flex items-center gap-2">
                  <Switch
                    size="small"
                    checked={isActive}
                    onChange={() => toggleDay(day.key)}
                  />
                  <span className={`text-sm w-12 ${isActive ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                    {day.short}
                  </span>

                  {isActive ? (
                    <div className="flex-1 flex flex-col gap-1">
                      {slots.map((slot, slotIdx) => (
                        <div key={slotIdx} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={slot.openTime}
                            onChange={e => updateSlot(slot.idx, 'openTime', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-28"
                          />
                          <span className="text-xs text-gray-400">to</span>
                          <input
                            type="time"
                            value={slot.closeTime}
                            onChange={e => updateSlot(slot.idx, 'closeTime', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-28"
                          />
                          {slots.length > 1 && (
                            <IconButton size="small" onClick={() => removeSlot(slot.idx)}>
                              <DeleteOutlineIcon fontSize="small" className="text-gray-400" />
                            </IconButton>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Closed</span>
                  )}

                  {isActive && (
                    <Button
                      size="small"
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => addSlot(day.key)}
                      sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 0, ml: 1 }}
                    >
                      Split
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Use "Split" to add a break in the middle of the day, e.g. a lunch closure.
        </p>
      </div>
    </div>
  )
}
