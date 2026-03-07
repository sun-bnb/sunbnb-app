export default function OnboardingGuidePage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Onboarding Guide for Beach Clubs</h1>
        <p className="text-xs text-gray-400 mb-8">SunBnB Partner Programme &middot; Effective: 7 March 2026</p>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Welcome to SunBnB</h2>
          <p>
            SunBnB is a marketplace platform operated by <strong>Refactory DX Oy</strong> (Business ID: 2940957-1, Helsinki, Finland). We connect travellers with beach venues across the Mediterranean. As a Beach Club partner, you retain full control of your business — SunBnB provides the technology to modernise your booking, payment, and operations workflow.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">You Are the Seller of Record</h2>
          <p>
            Refactory DX Oy facilitates the technology platform. <strong>Your Beach Club remains the Seller of Record</strong> for all customer transactions. This means:
          </p>
          <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1.5">
            <li>You are responsible for issuing invoices and receipts to customers.</li>
            <li>You bear the VAT/tax obligations for services rendered at your venue.</li>
            <li>The customer&rsquo;s contractual relationship is with your business, not with Refactory DX Oy.</li>
            <li>SunBnB generates tax-compliant receipts on your behalf through its platform, but the legal obligation remains yours.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Getting Started: Step by Step</h2>
          <ol className="mt-2 list-decimal list-inside text-gray-600 space-y-3">
            <li>
              <strong>Sign up</strong> — Create a partner account using your Google or email credentials. Provide your business name, address, and contact details.
            </li>
            <li>
              <strong>Identity Verification (KYC)</strong> — To comply with EU Anti-Money Laundering regulations and payment provider requirements, your identity must be verified. This process is handled securely by <strong>Mollie</strong>, our licensed payment service provider (PSD2-authorised). You will be asked to:
              <ul className="mt-1.5 ml-5 list-disc text-gray-500 space-y-1">
                <li>Provide your legal business registration details (e.g., CIF in Spain)</li>
                <li>Upload a government-issued ID for the authorised representative</li>
                <li>Confirm your business bank account (IBAN)</li>
              </ul>
              <p className="mt-1.5 ml-5 text-gray-500">
                Refactory DX Oy does not store or process your KYC documents — all verification is handled directly by Mollie under their own data processing agreements and regulatory obligations.
              </p>
            </li>
            <li>
              <strong>Connect Payments</strong> — Link your Mollie account to SunBnB via our secure OAuth integration (Mollie Connect). This authorises SunBnB to create payments on your behalf. Customer funds are deposited directly into your Mollie account.
            </li>
            <li>
              <strong>Configure Your Site</strong> — Use the partner dashboard to set up your beach layout, inventory (sunbeds, umbrellas, VIP zones), pricing, and operating hours.
            </li>
            <li>
              <strong>Go Live</strong> — Your venue listing becomes available to guests on the SunBnB consumer app. You can manage bookings, view real-time analytics, and handle orders from your dashboard.
            </li>
          </ol>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Payment Processing &amp; Fees</h2>
          <p>
            When a customer pays, the funds are split automatically:
          </p>
          <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1.5">
            <li><strong>You (the Beach Club)</strong> receive the service amount directly to your Mollie account.</li>
            <li><strong>Refactory DX Oy</strong> receives a platform service fee, deducted at the time of payment.</li>
          </ul>
          <p className="mt-2">
            This split-payment model is handled by Mollie&rsquo;s Application Fees mechanism. The exact fee percentage is defined in your partner agreement and is visible in your settlement reports.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Data Protection</h2>
          <p>
            Refactory DX Oy processes partner data in accordance with the EU General Data Protection Regulation (GDPR). We act as a data processor for transaction data and as a data controller for account management. Full details are available in our Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Questions?</h2>
          <ul className="space-y-1 text-gray-600">
            <li><strong>Refactory DX Oy</strong></li>
            <li>Sturenkatu 37-41 B 16, 00550 Helsinki, Finland</li>
            <li>Business ID: 2940957-1 &middot; VAT: FI29409571</li>
            <li>Email: partners@sunbnb.app</li>
            <li>Phone: +358 44 522 3555</li>
          </ul>
        </section>

      </div>
    </div>
  )
}
