import { getBusinessEntity } from '@repo/data/business-entity'

export default async function PartnerPrivacyPage() {
  const co = await getBusinessEntity()

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6 sm:py-12 text-sm text-gray-700 leading-relaxed break-words">

        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">Privacy Policy &mdash; Partner Portal</h1>
        <p className="text-xs text-gray-400 mb-8">Sunbnb Partner Programme &middot; Last updated: 11 October 2026</p>

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
          <h2 className="text-base font-semibold text-gray-900 mb-2">3. Cookies, Google Analytics and PostHog</h2>
          <p>
            We use essential cookies to keep you signed in and to remember your cookie choice. These do not require consent.
          </p>
          <p className="mt-2">
            If you choose <strong>Accept</strong> in the cookie banner, we also use <strong>Google Analytics 4</strong>, a web analytics service provided by Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland. Google Analytics sets cookies and collects pseudonymous usage data, such as the pages you view, the buttons you click, your approximate location, device and browser information, and the steps of the sign-up and setup flow (for example creating a venue or connecting payments). We use it to measure how visitors find the partner portal, including from sunbnb.app and try.sunbnb.app and from our advertising, and to improve the service. We do not send your name or email address to Google Analytics.
          </p>
          <p className="mt-2">
            With the same consent we also use <strong>PostHog</strong>, a product analytics service provided by PostHog Inc., with data stored in its EU cloud (Frankfurt, Germany). PostHog sets cookies and records how you use the partner portal: the pages you view, the buttons you click, page performance and, as session recordings, the movements and clicks on the page, with everything typed into form fields masked. When you are signed in, these events are linked to your internal account ID so we can understand how venues use the portal; we do not send your name or email address to PostHog. We use it to find and fix usability problems and to improve the service.
          </p>
          <p className="mt-2">
            Google Analytics and PostHog are only loaded after you accept. If you choose <strong>Decline</strong> (essential cookies only), nothing is sent to Google or PostHog. Analytics data is processed under Google&rsquo;s terms and may be transferred outside the EEA under the safeguards Google provides (such as standard contractual clauses). You can change your mind at any time by clearing your cookies for this site, which shows the banner again.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">4. Service Providers</h2>
          <p>
            We share data with providers that help us run the service: hosting, email delivery, payment providers you connect (Mollie, Stripe, Viva) with your consent, Google and PostHog (analytics), and, if you use the AI assistant, Anthropic (see section 5). We require all providers to handle data in line with the GDPR.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">5. AI Assistant, Documents and Photos</h2>
          <p>
            The partner portal includes an AI assistant. To answer you, the text of your conversation and the details of the venue you have open (for example prices, opening hours and inventory) are sent to <strong>Anthropic</strong> (Anthropic, PBC, United States), our sub-processor for the assistant, which processes them only to generate the reply. Anthropic does not use this data to train its models under its commercial terms. The transfer outside the EEA relies on the safeguards Anthropic provides (such as standard contractual clauses).
          </p>
          <p className="mt-2">
            You may also upload company documents (PDF, Word) or photos so the assistant can read them. An uploaded file is stored privately with our hosting provider, is visible only to your account, and is sent to Anthropic when you ask the assistant to read it. We delete uploaded files automatically <strong>30 days</strong> after upload. Please do not upload bank details, identity documents or other personal data you do not need us to read; the assistant is built never to enter bank account numbers, payment credentials, tax-authority credentials or personal ID numbers, and you must enter those yourself in your account settings. The assistant only prepares changes: nothing is saved to your venue until you review it and press Apply.
          </p>
          <p className="mt-2">
            Assistant proposals are kept for 90 days and conversations for 12 months so you can review what was changed, and are then deleted.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">6. Retention</h2>
          <p>
            We keep data only as long as needed for the purposes above or as required by law (invoicing and tax records are retained for the legally required period), and then delete or anonymise it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">7. Your Rights</h2>
          <p>
            You may request access to, correction, erasure, restriction or portability of your personal data, object to processing based on legitimate interests, and withdraw consent at any time. Contact us at {co.contactEmail ?? 'partners@sunbnb.app'}. You may also lodge a complaint with a supervisory authority in your EU member state.
          </p>
        </section>

      </div>
    </div>
  )
}
