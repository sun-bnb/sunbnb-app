import { getBusinessEntity } from '@repo/data/business-entity'

export default async function TermsOfService() {
  const co = await getBusinessEntity()

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Terms of Service</h1>
      <p className="text-xs text-gray-400 mb-8">Effective Date: 7 March 2026 &middot; Last Updated: 7 March 2026</p>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">1. Platform Operator</h2>
        <p>
          SunBnB (&ldquo;the Platform&rdquo;) is operated by <strong>{co.companyName}</strong>, a limited liability company registered in Finland.
        </p>
        <ul className="mt-2 space-y-1 text-gray-600">
          <li><strong>Legal Name:</strong> {co.companyName}</li>
          {co.businessId && <li><strong>Business ID:</strong> {co.businessId}</li>}
          {co.vatId && <li><strong>VAT ID:</strong> {co.vatId}</li>}
          {co.companyAddress && <li><strong>Registered Address:</strong> {co.companyAddress}</li>}
          {co.contactEmail && <li><strong>Email:</strong> {co.contactEmail}</li>}
          {co.contactPhone && <li><strong>Phone:</strong> {co.contactPhone}</li>}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">2. Nature of the Service</h2>
        <p>
          SunBnB acts solely as a <strong>commercial intermediary</strong> between consumers (&ldquo;you&rdquo; or &ldquo;the Guest&rdquo;) and independent beach venue operators (&ldquo;Beach Clubs&rdquo; or &ldquo;Partners&rdquo;). {co.companyName} does not own, manage, or operate any beach venues and is not a party to the rental agreement between you and the Beach Club.
        </p>
        <p className="mt-2">
          When you make a booking through SunBnB, you are entering into a direct contractual relationship with the Beach Club that is the <strong>Seller of Record</strong> for that transaction. The Beach Club is solely responsible for delivering the booked services, including sunbed availability, on-site conditions, and compliance with local regulations.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">3. Account &amp; Eligibility</h2>
        <p>
          You must be at least 18 years old to create an account. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us immediately at {co.contactEmail} if you suspect unauthorized access.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">4. Bookings &amp; Payments</h2>
        <p>
          All prices displayed on the Platform include applicable VAT unless stated otherwise. Payments are processed securely by third-party payment service providers (Stripe and/or Mollie). {co.companyName} does not store your full payment card details.
        </p>
        <p className="mt-2">
          Upon successful payment, your funds are routed directly to the Beach Club&rsquo;s payment account. {co.companyName} deducts a platform service fee automatically. This split-payment model is transparent: the Beach Club receives the merchant share, and {co.companyName} retains only the agreed platform fee.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">5. Cancellations &amp; Refunds</h2>
        <p>
          Please refer to our separate <a href="/cancellation-policy" className="text-blue-600 underline hover:text-blue-800">Cancellation &amp; Refund Policy</a> for detailed information on your cancellation rights, refund eligibility, and the respective responsibilities of {co.companyName} and the Beach Club.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">6. Intellectual Property</h2>
        <p>
          All content on the Platform &mdash; including text, graphics, logos, and software &mdash; is the property of {co.companyName} or its licensors and is protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works from this content without prior written consent.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">7. Limitation of Liability</h2>
        <p>
          {co.companyName} provides the Platform on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To the maximum extent permitted by law, {co.companyName} shall not be liable for: (a) the acts, errors, or omissions of any Beach Club; (b) personal injury, property damage, or loss of personal belongings at any venue; (c) any indirect, incidental, or consequential damages arising from your use of the Platform.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">8. Data Protection</h2>
        <p>
          We process personal data in accordance with the EU General Data Protection Regulation (GDPR) and our <a href="/privacy" className="text-blue-600 underline hover:text-blue-800">Privacy Policy</a>. The data controller is {co.companyName}.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">9. Governing Law &amp; Disputes</h2>
        <p>
          These Terms are governed by the laws of Finland. Any dispute arising from or in connection with these Terms shall be resolved in the District Court of Helsinki, Finland, unless mandatory consumer protection legislation in your country of residence provides otherwise.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">10. Changes to These Terms</h2>
        <p>
          {co.companyName} reserves the right to modify these Terms at any time. Material changes will be communicated via the Platform or email. Continued use of the Platform after such notification constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-2">11. Contact</h2>
        <p>
          If you have questions regarding these Terms, please contact us:
        </p>
        <ul className="mt-2 space-y-1 text-gray-600">
          <li><strong>{co.companyName}</strong></li>
          {co.companyAddress && <li>{co.companyAddress}</li>}
          {co.contactEmail && <li>Email: {co.contactEmail}</li>}
          {co.contactPhone && <li>Phone: {co.contactPhone}</li>}
        </ul>
      </section>

    </div>
  )

}
