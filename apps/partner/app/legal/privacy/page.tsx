import { getBusinessEntity } from '@repo/data/business-entity'

export default async function PartnerPrivacyPage() {
  const co = await getBusinessEntity()

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Privacy Policy &mdash; Partner Portal</h1>
        <p className="text-xs text-gray-400 mb-8">Sunbnb Partner Programme &middot; Last updated: 10 October 2026</p>

        <p className="mb-6">
          This policy explains how personal data is handled when you visit the Sunbnb partner portal (partner.sunbnb.app), create a partner account, or manage a venue with us. The privacy policy for guests who book through sunbnb.app is published separately on that site.
        </p>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">1. Data Controller</h2>
          <ul className="space-y-1 text-gray-600">
            <li><strong>{co.companyName}</strong></li>
            {co.companyAddress && <li>{co.companyAddress}</li>}
            {co.contactEmail && <li>{co.contactEmail}</li>}
            {co.contactPhone && <li>{co.contactPhone}</li>}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">2. Data We Process</h2>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li><strong>Account data:</strong> name, email address, phone number, company and business details, sign-in method (Google or email and password).</li>
            <li><strong>Venue and transaction data:</strong> venues, inventory, reservations, orders, invoices and payout information. For guest transaction data we act as a processor on your behalf; for account management we are the controller.</li>
            <li><strong>Technical data:</strong> IP address, browser and device type, and the pages you use.</li>
          </ul>
          <p className="mt-2">
            The legal basis is performance of our contract with you, compliance with legal obligations (for example invoicing and tax records), and our legitimate interest in keeping the service secure. Analytics is based on your consent (see below).
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">3. Cookies and Google Analytics</h2>
          <p>
            We use essential cookies to keep you signed in and to remember your cookie choice. These do not require consent.
          </p>
          <p className="mt-2">
            If you choose <strong>Accept</strong> in the cookie banner, we also use <strong>Google Analytics 4</strong>, a web analytics service provided by Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland. Google Analytics sets cookies and collects pseudonymous usage data, such as the pages you view, the buttons you click, your approximate location, device and browser information, and the steps of the sign-up and setup flow (for example creating a venue or connecting payments). We use it to measure how visitors find the partner portal, including from sunbnb.app and try.sunbnb.app and from our advertising, and to improve the service. We do not send your name or email address to Google Analytics.
          </p>
          <p className="mt-2">
            Google Analytics is only loaded after you accept. If you choose <strong>Decline</strong> (essential cookies only), nothing is sent to Google. Analytics data is processed under Google&rsquo;s terms and may be transferred outside the EEA under the safeguards Google provides (such as standard contractual clauses). You can change your mind at any time by clearing your cookies for this site, which shows the banner again.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">4. Service Providers</h2>
          <p>
            We share data with providers that help us run the service: hosting, email delivery, payment providers you connect (Mollie, Stripe, Viva) and, with your consent, Google (analytics). We require all providers to handle data in line with the GDPR.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">5. Retention</h2>
          <p>
            We keep data only as long as needed for the purposes above or as required by law (invoicing and tax records are retained for the legally required period), and then delete or anonymise it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">6. Your Rights</h2>
          <p>
            You may request access to, correction, erasure, restriction or portability of your personal data, object to processing based on legitimate interests, and withdraw consent at any time. Contact us at {co.contactEmail ?? 'partners@sunbnb.app'}. You may also lodge a complaint with a supervisory authority in your EU member state.
          </p>
        </section>

      </div>
    </div>
  )
}
