# Payment Rules

- Never trust client-submitted prices. Always fetch amounts from the database.
- Payment amounts must always be positive and validated before sending to Stripe/Mollie.
- All invoice creation must be idempotent — check for existing invoices before creating new ones, double-check inside the transaction.
- Service fees use a three-tier cascade: site → partnerAccount → settings. Never hardcode fee amounts.
- Agent/marketplace model: the PARTNER invoice is booked GROSS (the full price the consumer paid); the platform commission is a separate B2B invoice billed TO the partner (PLATFORM issuer, recipient = partner). Never net the fee out of partner revenue, never add it to the consumer total — PARTNER + PLATFORM do not sum to the consumer payment. Cross-border EU B2B → reverse charge (0 VAT, partner self-accounts). See `packages/data/src/payment.ts` (the `processConfirmed*` functions).
- Mollie/PSP processing fees are VAT-exempt — never run reverse-VAT on them; they reconcile via `Invoice.processingFee`, not the VAT total.
- All prices are VAT-inclusive. Use reverse VAT calculation: `baseAmount = round(grossAmount / (1 + vatRate / 100))`.
- Use `round()` from `@repo/data` for all financial calculations (2 decimal places).
- Demo payments use `pi_demo_{timestamp}` prefix. Always check `isDemoPayment()` before calling Stripe/Mollie APIs.
- Stripe webhooks require signature verification via `stripe-signature` header. Mollie webhooks validate payment ID format (`/^tr_[A-Za-z0-9]{1,50}$/`).
- The reconciliation endpoint (`/api/reconcile`) is the safety net for stuck payments — it must be protected by `RECONCILIATION_SECRET`.
