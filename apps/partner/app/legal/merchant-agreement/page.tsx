export default function MerchantAgreementPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Merchant Agreement &amp; Split Payments</h1>
        <p className="text-xs text-gray-400 mb-8">SunBnB Partner Programme &middot; Effective: 7 March 2026</p>

        {/* Split payment clause */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">1. Payment Flow &amp; Fund Distribution</h2>
          <p>
            SunBnB, operated by <strong>Refactory DX Oy</strong> (Business ID: 2940957-1), facilitates payments between consumers (&ldquo;Guests&rdquo;) and Beach Club partners (&ldquo;Merchants&rdquo;) via the Mollie payment platform under the Mollie for Platforms (intermediary) model.
          </p>
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="font-semibold text-gray-900 mb-2">When a customer completes a payment:</p>
            <ol className="list-decimal list-inside text-gray-600 space-y-2">
              <li>
                The payment is created on the <strong>Merchant&rsquo;s own Mollie account</strong>, using the Merchant&rsquo;s OAuth-linked credentials. The Merchant is the <strong>Seller of Record</strong>.
              </li>
              <li>
                Mollie automatically deducts the <strong>platform service fee</strong> (the &ldquo;Application Fee&rdquo;) from the transaction amount and routes it to Refactory DX Oy&rsquo;s platform account.
              </li>
              <li>
                The remaining net amount is deposited directly into the <strong>Merchant&rsquo;s Mollie balance</strong>, from which it is settled to the Merchant&rsquo;s business bank account on Mollie&rsquo;s standard settlement schedule.
              </li>
            </ol>
          </div>
          <p className="mt-3">
            Refactory DX Oy does not hold, pool, or intermediate customer funds at any point. All funds flow through the regulated Mollie payment infrastructure.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">2. Platform Service Fee</h2>
          <p>
            The platform service fee compensates Refactory DX Oy for providing the SunBnB technology platform, including: booking management, consumer-facing app, real-time inventory, settlement reporting, tax-compliant receipt generation, and customer support infrastructure.
          </p>
          <p className="mt-2">
            The fee rate is defined in the individual partner agreement and may vary by site configuration. The fee is deducted at the transaction level and is itemised in each settlement report. The fee is inclusive of the standard Mollie payment processing cost unless otherwise agreed.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">3. Seller of Record</h2>
          <p>
            The Merchant (Beach Club operator) is the Seller of Record for all transactions. This means:
          </p>
          <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1.5">
            <li>The Merchant is responsible for issuing VAT-compliant invoices or receipts to Guests.</li>
            <li>The Merchant bears all tax obligations (VAT, income tax, local tourism levies) arising from services rendered.</li>
            <li>The Merchant is the contracting party vis-à-vis the Guest for the delivery of beach services.</li>
            <li>Refactory DX Oy does not act as a reseller, agent, or commissionaire for tax purposes.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">4. Refund Responsibility</h2>
          <p>
            Refunds to Guests are initiated through the SunBnB platform and processed via the Merchant&rsquo;s Mollie account. The Merchant bears the economic cost of refunds for cancellations attributable to the Merchant (e.g., venue closure, overbooking). Where a refund results from a platform error, Refactory DX Oy will bear the cost.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">5. Settlement &amp; Reporting</h2>
          <p>
            Settlements from Mollie to the Merchant follow Mollie&rsquo;s standard settlement cycle (typically T+1 to T+2 business days for established accounts). Refactory DX Oy provides itemised settlement reports within the partner dashboard, including gross revenue, platform fees, Mollie transaction fees, refunds, and net payouts.
          </p>
        </section>

        {/* P2B Transparency Statement */}
        <section className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-2">6. Transparency Statement (EU P2B Regulation)</h2>
          <p className="text-gray-700">
            In compliance with <strong>Regulation (EU) 2019/1150</strong> (Platform-to-Business Regulation), Refactory DX Oy discloses the following:
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">6.1 Search Ranking &amp; Listing Criteria</h3>
          <p>
            Venue listings on the SunBnB consumer app are ranked based on the following parameters:
          </p>
          <ul className="mt-1.5 list-disc list-inside text-gray-600 space-y-1">
            <li><strong>Geographic proximity</strong> to the Guest&rsquo;s search location (primary factor)</li>
            <li><strong>Availability</strong> — venues with higher real-time availability are ranked higher</li>
            <li><strong>Completeness of listing</strong> — venues with photos, descriptions, and pricing configured receive a ranking boost</li>
            <li><strong>Guest rating &amp; review score</strong> — where available</li>
          </ul>
          <p className="mt-2">
            No Merchant may pay Refactory DX Oy for preferential ranking. There is no paid promotion or &ldquo;boosted listing&rdquo; programme. All ranking factors are non-discriminatory and apply equally to all Merchants.
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">6.2 Data Access</h3>
          <p>
            Merchants have full access to their own transaction data, booking history, and customer interaction data through the partner dashboard. Refactory DX Oy does not share individual Merchant data with competing Merchants. Aggregated, anonymised platform statistics may be used for internal analytics and product improvement.
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">6.3 Differentiated Treatment</h3>
          <p>
            Refactory DX Oy does not offer goods or services that compete with those of its Merchants. The platform does not operate its own beach venues or sunbed rental services.
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">6.4 Complaint Handling</h3>
          <p>
            Merchants may raise complaints regarding platform practices, ranking, or account matters by contacting <a href="mailto:partners@sunbnb.app" className="text-blue-600 underline">partners@sunbnb.app</a>. Refactory DX Oy will acknowledge receipt within 5 business days and provide a substantive response within 15 business days. Where a complaint cannot be resolved bilaterally, Merchants may refer the matter to an independent mediator, as described in the partner agreement.
          </p>

          <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">6.5 Account Restriction or Termination</h3>
          <p>
            Refactory DX Oy may restrict or terminate a Merchant&rsquo;s account in the following circumstances: (a) breach of the partner agreement, (b) non-compliance with applicable law, (c) fraudulent activity, (d) repeated guest complaints without resolution. Prior to restriction or termination, the Merchant will be notified in writing with a statement of reasons, except where immediate action is required to prevent harm, fraud, or legal non-compliance. A 30-day notice period applies for termination without cause.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">7. Governing Law</h2>
          <p>
            This agreement is governed by the laws of Finland. Disputes shall be resolved in the District Court of Helsinki, unless mandatory local law in the Merchant&rsquo;s jurisdiction provides otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">8. Contact</h2>
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
