'use client'

import React, { useCallback, useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { createPartnerReservation, getAvailableSunbeds } from './actions'

interface AvailableItem {
  id: string
  number: number
  category: string | null
  pairId: string | null
}

export default function CreateReservationModal({
  siteId,
  initialDate,
  onClose,
  onCreated,
}: {
  siteId: string
  initialDate: string  // YYYY-MM-DD
  onClose: () => void
  onCreated: () => void
}) {
  const [fromDate, setFromDate] = useState(initialDate)
  const [toDate, setToDate] = useState(initialDate)
  const [paymentType, setPaymentType] = useState<'cash' | 'free'>('cash')
  const [guestName, setGuestName] = useState('')
  const [guestContact, setGuestContact] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('CreateReservationModal')

  // Fetch available sunbeds when date range changes
  const fetchAvailable = useCallback(async () => {
    if (!fromDate || !toDate) return
    setLoading(true)
    setSelectedIds(new Set())
    const result = await getAvailableSunbeds(siteId, fromDate, toDate)
    setAvailableItems(result.items || [])
    setLoading(false)
  }, [siteId, fromDate, toDate])

  useEffect(() => {
    fetchAvailable()
  }, [fetchAvailable])

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(availableItems.map(i => i.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  function handleSubmit() {
    if (selectedIds.size === 0) {
      setError(t('selectAtLeast'))
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createPartnerReservation({
        siteId,
        itemIds: Array.from(selectedIds),
        from: fromDate,
        to: toDate,
        paymentType,
        guestName: guestName || undefined,
        guestContact: guestContact || undefined,
        internalNotes: notes || undefined,
      })
      if (result.status === 'ok') {
        onCreated()
        onClose()
      } else {
        setError(result.errors?.[0] || 'Failed to create reservation')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">{t('title')}</h2>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none p-2">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('from')}</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-full border-2 rounded-xl px-4 py-3 text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('to')}</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                min={fromDate}
                className="w-full border-2 rounded-xl px-4 py-3 text-base"
              />
            </div>
          </div>

          {/* Guest info */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('guestName')}</label>
            <input
              type="text"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              placeholder={t('optional')}
              className="w-full border-2 rounded-xl px-4 py-3 text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('phoneOrEmail')}</label>
            <input
              type="text"
              value={guestContact}
              onChange={e => setGuestContact(e.target.value)}
              placeholder={t('optional')}
              className="w-full border-2 rounded-xl px-4 py-3 text-base"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('notes')}</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('optional')}
              className="w-full border-2 rounded-xl px-4 py-3 text-base"
            />
          </div>

          {/* Payment type */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">{t('payment')}</label>
            <div className="flex gap-3">
              <button
                onClick={() => setPaymentType('cash')}
                className={`flex-1 py-3.5 text-base font-bold rounded-xl border-2 transition-colors ${
                  paymentType === 'cash'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {t('cash')}
              </button>
              <button
                onClick={() => setPaymentType('free')}
                className={`flex-1 py-3.5 text-base font-bold rounded-xl border-2 transition-colors ${
                  paymentType === 'free'
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {t('free')}
              </button>
            </div>
          </div>

          {/* Sunbed selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-bold text-gray-700">
                {t('pickSunbeds', { count: selectedIds.size })}
              </label>
              {availableItems.length > 0 && (
                <div className="flex gap-3">
                  <button onClick={selectAll} className="text-sm font-bold text-blue-600 active:text-blue-800">{t('all')}</button>
                  {selectedIds.size > 0 && (
                    <button onClick={deselectAll} className="text-sm font-bold text-gray-400 active:text-gray-600">{t('clear')}</button>
                  )}
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              </div>
            ) : availableItems.length === 0 ? (
              <div className="text-center py-6 text-base text-gray-400">
                {t('noSunbedsFree')}
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2 max-h-[220px] overflow-y-auto p-1">
                {availableItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`
                      py-3 text-base font-bold rounded-xl border-2 transition-colors select-none
                      ${selectedIds.has(item.id)
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-300 active:border-blue-400'
                      }
                    `}
                  >
                    {item.number}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-base font-bold text-red-600 bg-red-50 px-4 py-3 rounded-xl border-2 border-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-t-2 border-gray-200"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
          <button
            disabled={isPending || selectedIds.size === 0}
            onClick={handleSubmit}
            className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl active:bg-gray-800 disabled:opacity-50 transition-colors text-lg"
          >
            {isPending ? t('creating') : t('bookSunbeds', { count: selectedIds.size })}
          </button>
        </div>
      </div>
    </div>
  )
}
