/**
 * `money` aspect: how a sale is priced and split for this site -- the resolved commission fee per
 * service (site -> partner account -> platform settings cascade, plus the launch-offer waiver), VAT
 * rates, and a worked example. Every number comes from the `@repo/data` helpers the charge and
 * invoice paths use (`resolveServiceFee`, `chargeableServiceFee`, `serviceFeeForUnits`,
 * `computeVatAndBaseAmounts`, Stripe fee policy); nothing is recomputed inline here.
 *
 * Agent model (payments.md): the consumer pays the listed price only; the PARTNER invoice is the
 * gross price; the platform commission is a separate B2B invoice billed to the partner.
 */
import {
  chargeableServiceFee,
  computeVatAndBaseAmounts,
  getSiteFeeContext,
  resolveServiceFee,
  round,
  serviceFeeForUnits,
} from '@repo/data/payment'
import { COMMISSIONED_SERVICE_CODES } from '@repo/data/pricing-tiers'
import { stripeApplicationFee, stripePassThrough } from '@repo/data/payment-providers/fee-policy'
import type { InspectProvider } from './types'

/** A beach-day example when the site has no price yet. */
const FALLBACK_PRICE = 20
const EXAMPLE_BEDS = 2

type Fee = { chargeType: string; feeAmount: number | null; percentage: number | null }

const feeText = (f: Fee | undefined): string | null =>
  !f ? null : f.chargeType === 'fixed' ? `${f.feeAmount ?? 0} EUR fixed per bed` : `${f.percentage ?? 0}% of the total`

export const moneyProvider: InspectProvider = {
  name: 'money',
  summary: 'Commission fee cascade (site -> account -> platform) resolved for this site, VAT rates, launch-offer waiver and a worked example split computed with the platform helpers.',
  examples: ['What commission do I pay?', 'How is a booking split between me and Sunbnb?', 'What VAT applies to a sunbed?', 'Is my commission waived right now?'],
  async describe(ctx) {
    let fc
    try {
      fc = await getSiteFeeContext(ctx.siteId)
    } catch {
      return { ok: false, error: 'site_not_found' }
    }
    const siteFees = fc.site.serviceFees
    const accountFees = fc.partnerAccount?.serviceFees ?? []
    const settingsFees = fc.settings?.serviceFees ?? []
    const now = new Date()

    const services = COMMISSIONED_SERVICE_CODES.map((code) => {
      const fee = resolveServiceFee(siteFees, accountFees, settingsFees, code, fc.tier)
      const charged = chargeableServiceFee(fee, fc.partnerAccount, now)
      const source = !fee ? 'none' : siteFees.includes(fee) ? 'site override' : accountFees.includes(fee) ? 'account override' : fee.subscriptionTier ? `platform fee for the ${fee.subscriptionTier} plan` : 'platform default'
      return {
        service: code,
        source,
        fee: feeText(fee),
        chargedNow: charged ? feeText(charged) : fee ? 'waived (launch offer)' : null,
      }
    })

    const sunbedFee = resolveServiceFee(siteFees, accountFees, settingsFees, 'sunbed-rental', fc.tier)
    const charged = chargeableServiceFee(sunbedFee, fc.partnerAccount, now)
    const vat = fc.site.vat ?? 0
    const price = fc.site.price && fc.site.price > 0 ? fc.site.price : FALLBACK_PRICE
    const total = round(price * EXAMPLE_BEDS)
    const units = EXAMPLE_BEDS
    const split = computeVatAndBaseAmounts(total, vat)
    const commission = serviceFeeForUnits(charged, { total, units })
    const platformVat = fc.settings?.vat ?? 0
    const commissionSplit = computeVatAndBaseAmounts(commission, platformVat)
    const isStripe = fc.site.paymentProvider === 'stripe'
    const processing = isStripe ? stripePassThrough(total) : 0
    const applicationFee = isStripe ? stripeApplicationFee(commission, total) : commission
    const reverseCharge = !!fc.partnerAccount?.businessId && !!fc.partnerAccount?.country && !!fc.settings?.country && fc.partnerAccount.country !== fc.settings.country

    return {
      ok: true,
      model: 'The guest pays the listed price only. The PARTNER invoice is that gross price; the platform commission is a separate invoice billed to the partner (never added to the guest total, never netted from the partner invoice). All prices are VAT-inclusive.',
      cascade: 'site override -> partner account override -> platform settings (the plan-specific fee first, then the default). A launch-offer waiver can zero the charged commission.',
      plan: fc.tier ?? 'STARTER',
      services,
      launchOffer: charged || !sunbedFee ? 'not waiving commission' : 'commission waived by the launch offer for bookings in its window',
      vat: {
        sunbedPercent: fc.site.vat ?? null,
        rentalPercent: fc.site.rentalVat ?? null,
        platformCommissionPercent: fc.settings?.vat ?? null,
        commissionReverseCharge: reverseCharge ? 'partner is in another EU country with a VAT id: the commission invoice carries 0 VAT (reverse charge)' : 'domestic commission invoice: VAT at the platform rate, extracted from the fee',
      },
      provider: fc.site.paymentProvider ?? null,
      example: {
        assumes: `${EXAMPLE_BEDS} beds at ${price} EUR${fc.site.price && fc.site.price > 0 ? ' (this site\'s price)' : ' (placeholder: the site has no price yet)'}, sunbed-rental fee, ${vat}% VAT`,
        guestPays: total,
        partnerInvoice: { gross: total, net: split.baseAmount, vat: split.vatAmount },
        commission: { gross: commission, net: commissionSplit.baseAmount, vat: reverseCharge ? 0 : commissionSplit.vatAmount, rule: charged?.chargeType === 'fixed' ? 'fixed fee x number of beds' : 'percentage of the total, once' },
        ...(isStripe ? { cardProcessingPassThrough: processing } : {}),
        takenAsApplicationFee: applicationFee,
        partnerKeeps: round(total - applicationFee),
        note: 'partnerKeeps = guest price minus what is taken at charge time (commission, plus the card-processing pass-through on Stripe). Payment-provider processing fees are VAT-exempt and reconcile on the PLATFORM invoice, not in the VAT total.',
      },
    }
  },
}
