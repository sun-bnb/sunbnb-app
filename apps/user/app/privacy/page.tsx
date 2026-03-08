import { getBusinessEntity } from '@repo/data/business-entity'

export default async function Privacy() {
  const co = await getBusinessEntity()

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Privacy Policy</h1>
      <p className="text-xs text-gray-400 mb-8">Effective Date: 6 December 2024 &middot; Last Updated: 8 March 2026</p>

      <p className="mb-6">
        Sunbnb (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting your personal data and respecting your privacy. This Privacy Policy explains how we collect, use, store, and share your information when you interact with our website and services.
      </p>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">1. Data Controller</h2>
        <p>The data controller responsible for your personal data is:</p>
        <ul className="mt-2 space-y-1 text-gray-600">
          <li><strong>{co.companyName}</strong></li>
          {co.companyAddress && <li>{co.companyAddress}</li>}
          {co.contactEmail && <li>{co.contactEmail}</li>}
          {co.contactPhone && <li>{co.contactPhone}</li>}
        </ul>
        <p className="mt-2">If you have any questions or concerns about this policy or your rights, please contact us at the above details.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">2. Data We Collect</h2>
        <p>We may collect the following categories of personal data about you:</p>
        <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1">
          <li><strong>Personal Information:</strong> Name, email address, phone number, billing address.</li>
          <li><strong>Technical Data:</strong> IP address, browser type, operating system, and usage data from our website.</li>
          <li><strong>Transactional Data:</strong> Payment information, purchase history, and order details.</li>
        </ul>
        <p className="mt-2">We may collect this data directly from you (e.g., through forms or account creation) or automatically when you use our services.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">3. How We Use Your Data</h2>
        <p>We process your data for the following purposes and legal bases:</p>
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 font-semibold text-gray-900">Purpose</th>
                <th className="text-left py-2 font-semibold text-gray-900">Legal Basis</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100"><td className="py-1.5">To provide our services</td><td className="py-1.5">Performance of a contract</td></tr>
              <tr className="border-b border-gray-100"><td className="py-1.5">To process payments</td><td className="py-1.5">Performance of a contract</td></tr>
              <tr className="border-b border-gray-100"><td className="py-1.5">To comply with legal obligations</td><td className="py-1.5">Legal obligation</td></tr>
              <tr><td className="py-1.5">To improve our services</td><td className="py-1.5">Legitimate interest</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">4. Sharing Your Data</h2>
        <p>We may share your personal data with:</p>
        <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1">
          <li><strong>Service Providers:</strong> Such as payment processors, hosting services, or analytics platforms.</li>
          <li><strong>Legal Authorities:</strong> When required by law or to protect our legal rights.</li>
        </ul>
        <p className="mt-2">We ensure all third parties handle your data in compliance with GDPR.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">5. International Data Transfers</h2>
        <p>
          If we transfer your data outside the European Economic Area (EEA), we will ensure it is protected by appropriate safeguards, such as binding corporate rules, standard contractual clauses approved by the European Commission, or certification mechanisms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">6. Data Retention</h2>
        <p>
          We retain your personal data only as long as necessary to fulfill the purposes outlined in this Privacy Policy or as required by law. Once retention is no longer necessary, we securely delete or anonymize the data.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">7. Your Rights</h2>
        <p>Under GDPR, you have the following rights:</p>
        <ul className="mt-2 list-disc list-inside text-gray-600 space-y-1">
          <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
          <li><strong>Correction:</strong> Request the correction of inaccurate or incomplete data.</li>
          <li><strong>Erasure:</strong> Request deletion of your personal data (&ldquo;right to be forgotten&rdquo;).</li>
          <li><strong>Restriction:</strong> Request restriction of data processing in certain circumstances.</li>
          <li><strong>Portability:</strong> Request your data in a machine-readable format.</li>
          <li><strong>Objection:</strong> Object to processing based on legitimate interests or for direct marketing.</li>
          <li><strong>Withdraw Consent:</strong> Withdraw your consent at any time, where processing is based on consent.</li>
        </ul>
        <p className="mt-2">To exercise any of these rights, please contact us at {co.contactEmail}.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">8. Cookies</h2>
        <p>
          We only use essential cookies that are necessary for the operation of our website. You can set your browser to block or alert you about these cookies, but some parts of the site may not function properly.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">9. Security Measures</h2>
        <p>
          We implement technical and organizational measures to protect your data against unauthorized access, alteration, disclosure, or destruction. However, no data transmission over the internet is entirely secure, and we cannot guarantee absolute security.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">10. Updates to this Privacy Policy</h2>
        <p>
          We may update this policy from time to time to reflect changes in our practices or legal requirements. The updated version will be published on our website, and significant changes will be notified to you.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-2">11. Complaints</h2>
        <p>
          If you believe we have violated your data protection rights, you have the right to lodge a complaint with a supervisory authority in your EU member state.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-2">Contact Us</h2>
        <p>If you have questions about this Privacy Policy or your personal data, please contact us:</p>
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
