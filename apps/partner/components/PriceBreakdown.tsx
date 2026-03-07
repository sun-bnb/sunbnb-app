'use client'

import { SiteProps } from '@/types/shared'

function round(amount: number) {
  return Math.round(amount * 100) / 100
}

export default function PriceBreakdown({ price, site }: { price: string; site: SiteProps }) {
  const priceNum = Number(price)
  if (!priceNum || priceNum <= 0) return null

  const vatRate = site.vat ?? 0
  const serviceFee = site.serviceFees?.find(f => f.serviceCode === 'sunbed-rental')

  const feeAmount = serviceFee
    ? serviceFee.chargeType === 'fixed'
      ? (serviceFee.feeAmount ?? 0)
      : round(((serviceFee.percentage ?? 0) / 100) * priceNum)
    : 0

  // Payment processing fee (fixed + percentage of price)
  const ppf = site.paymentProcessingFee
  const procFixed = ppf?.fixedAmount ?? 0
  const procPct = ppf?.percentage ?? 0
  const procAmount = round(procFixed + (procPct / 100) * priceNum)

  // Fee deducted from partner share; partner handles own VAT
  const partnerGross = round(priceNum - feeAmount - procAmount)
  const partnerBase = vatRate > 0
    ? round(partnerGross / (1 + vatRate / 100))
    : partnerGross
  const partnerVat = round(partnerGross - partnerBase)

  // Build processing fee label parts
  const procParts: string[] = []
  if (procFixed > 0) procParts.push(`${procFixed.toFixed(2)} \u20AC`)
  if (procPct > 0) procParts.push(`${procPct}%`)
  const procLabel = procParts.length > 0 ? ` (${procParts.join(' + ')})` : ''

  return (
    <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs">
      <div className="flex justify-between text-gray-500 mb-1">
        <span>Customer pays</span>
        <span>{priceNum.toFixed(2)} &euro;</span>
      </div>
      {feeAmount > 0 && (
        <div className="flex justify-between text-gray-500 mb-1">
          <span>
            Service fee
            {serviceFee?.chargeType === 'fixed'
              ? ''
              : ` (${(serviceFee?.percentage ?? 0).toFixed(0)}%)`}
          </span>
          <span className="text-red-500">&minus;{feeAmount.toFixed(2)} &euro;</span>
        </div>
      )}
      {procAmount > 0 && (
        <div className="flex justify-between text-gray-500 mb-1">
          <span>Processing fee{procLabel}</span>
          <span className="text-red-500">&minus;{procAmount.toFixed(2)} &euro;</span>
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
