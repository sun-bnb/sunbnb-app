# Payment Rules

- Never trust client-submitted prices. Always fetch amounts from the database.
- Payment amounts must always be positive and validated before sending to Stripe/Mollie.
- All invoice creation must be idempotent — check for existing invoices before creating new ones, double-check inside the transaction.
- Service fees use a three-tier cascade: site → partnerAccount → settings. Never hardcode fee amounts.
- For reservations, service fee is deducted from partner revenue (customer pays listed price). For orders, service fee is added to customer total. Do not mix these up.
- All prices are VAT-inclusive. Use reverse VAT calculation: `baseAmount = round(grossAmount / (1 + vatRate / 100))`.
- Use `round()` from `@repo/data` for all financial calculations (2 decimal places).
- Demo payments use `pi_demo_{timestamp}` prefix. Always check `isDemoPayment()` before calling Stripe/Mollie APIs.
- Stripe webhooks require signature verification via `stripe-signature` header. Mollie webhooks validate payment ID format (`/^tr_[A-Za-z0-9]{1,50}$/`).
- The reconciliation endpoint (`/api/reconcile`) is the safety net for stuck payments — it must be protected by `RECONCILIATION_SECRET`.
