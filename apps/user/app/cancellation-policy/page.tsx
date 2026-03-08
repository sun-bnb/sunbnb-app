import { getBusinessEntity } from '@repo/data/business-entity'

export default async function CancellationPolicy() {
  const co = await getBusinessEntity()

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Cancellation &amp; Refund Policy</h1>
      <p className="text-xs text-gray-400 mb-8">Effective Date: 7 March 2026 &middot; Last Updated: 7 March 2026</p>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">1. Scope</h2>
        <p>
          This policy applies to all sunbed reservations and ancillary service bookings (&ldquo;Bookings&rdquo;) made through the SunBnB platform operated by <strong>{co.companyName}</strong>{co.businessId ? ` (Business ID: ${co.businessId})` : ''}. It defines the cancellation and refund rules applicable to consumers (&ldquo;Guests&rdquo;) and the respective obligations of {co.companyName} and the Beach Club.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">2. Role of {co.companyName}</h2>
        <p>
          {co.companyName} acts as a <strong>commercial intermediary</strong>. The contractual relationship for the delivery of sunbed and beach services exists directly between you and the Beach Club (the &ldquo;Seller of Record&rdquo;). {co.companyName} facilitates the booking and payment process only.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">3. Cancellation by the Guest</h2>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 font-semibold text-gray-900">Cancellation Window</th>
                <th className="text-left py-2 font-semibold text-gray-900">Refund</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100">
                <td className="py-2">More than 24 hours before the booking date</td>
                <td className="py-2">Full refund (100%)</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2">Between 24 hours and 2 hours before the booking date</td>
                <td className="py-2">50% refund</td>
              </tr>
              <tr>
                <td className="py-2">Less than 2 hours before the booking date, or no-show</td>
                <td className="py-2">No refund</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-gray-500 text-xs">
          Some Beach Clubs may offer more generous cancellation terms. The policy displayed on the Beach Club&rsquo;s listing page at the time of booking prevails where it is more favourable to the Guest.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">4. Cancellation by the Beach Club</h2>
        <p>
          If a Beach Club cancels a confirmed Booking (e.g., due to weather closure, equipment failure, or force majeure), you are entitled to a <strong>full refund (100%)</strong>. The Beach Club bears sole responsibility for such cancellations.
        </p>
        <p className="mt-2">
          {co.companyName} will process the refund to your original payment method within 5–10 business days of the cancellation being confirmed.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">5. Refund Method &amp; Timing</h2>
        <p>
          Refunds are issued to the original payment method (credit/debit card, iDEAL, or other supported method). Processing times depend on your payment provider and are typically:
        </p>
        <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1">
          <li>Card payments: 5–10 business days</li>
          <li>iDEAL / bank transfers: 2–5 business days</li>
        </ul>
        <p className="mt-2">
          {co.companyName} initiates refunds promptly. Delays beyond our control (e.g., bank processing times) are the responsibility of the Guest&rsquo;s financial institution.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">6. Food &amp; Beverage Orders</h2>
        <p>
          On-site food and beverage orders placed through the Platform are <strong>non-refundable</strong> once the order has been confirmed and preparation has begun. If you receive an incorrect or defective order, please contact the Beach Club staff directly for resolution.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">7. EU Consumer Rights</h2>
        <p>
          Under EU Directive 2011/83/EU, the statutory 14-day withdrawal right does <strong>not apply</strong> to leisure services where a specific date or period of performance is agreed upon (Article 16(l)). Sunbed bookings fall under this exemption. However, {co.companyName} honours the cancellation windows defined above as a voluntary customer protection measure.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">8. Disputes</h2>
        <p>
          If you believe a refund has been unjustly denied, please contact us at <a href={`mailto:${co.contactEmail}`} className="text-blue-600 underline hover:text-blue-800">{co.contactEmail}</a>. We will mediate between you and the Beach Club to reach a fair resolution. If the dispute cannot be resolved amicably, the laws of Finland apply and the competent court is the District Court of Helsinki, subject to mandatory consumer protection provisions in your country of residence.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-2">9. Contact</h2>
        <ul className="space-y-1 text-gray-600">
          <li><strong>{co.companyName}</strong></li>
          {co.companyAddress && <li>{co.companyAddress}</li>}
          {(co.businessId || co.vatId) && (
            <li>
              {co.businessId ? `Business ID: ${co.businessId}` : ''}
              {co.businessId && co.vatId ? ' \u00b7 ' : ''}
              {co.vatId ? `VAT: ${co.vatId}` : ''}
            </li>
          )}
          {co.contactEmail && <li>Email: {co.contactEmail}</li>}
          {co.contactPhone && <li>Phone: {co.contactPhone}</li>}
        </ul>
      </section>

    </div>
  )

}
