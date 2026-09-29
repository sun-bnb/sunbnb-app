/**
 * The platform's own legal identity — the issuer on every PLATFORM commission
 * invoice.
 *
 * `Settings` is a per-COUNTRY table (VAT rate, currency, fee jurisdiction), but
 * company identity is a SINGLETON that happens to be copied onto every row. The
 * old reader did `findFirst()` with no `where` and no `orderBy` across those
 * rows, so which one answered was down to Postgres' physical order.
 *
 * That was not academic. `PLATFORM-2026-00001` in production was issued by
 * Sunbnb España SL — itself a Veri*factu-obligated party — carrying a NULL tax
 * id and the company name `Platform Operator`, which is the DEFAULTS constant
 * below. A placeholder leaked onto a real invoice and into its hash.
 *
 * So there are now two readers, and the distinction is the point:
 *   - `getBusinessEntity()` is for DISPLAY. It still falls back to placeholders,
 *     because a footer with no company name is worse than a generic one.
 *   - `requirePlatformIssuer()` is for ISSUING. It refuses to invent anything
 *     and throws instead, because an invoice is a legal document and a
 *     placeholder on one is worse than no invoice at all.
 */
import prisma from '../index'

export type BusinessEntity = {
  companyName: string
  companyAddress: string
  businessId: string
  vatId: string
  contactEmail: string
  contactPhone: string
  vatRate: number
}

const DEFAULTS: BusinessEntity = {
  companyName: 'Platform Operator',
  companyAddress: '',
  businessId: '',
  vatId: '',
  contactEmail: 'info@sunbnb.app',
  contactPhone: '',
  vatRate: 25.5,
}

/**
 * Identity fields, deterministically chosen.
 *
 * Prefers a row that actually carries a tax id — identity is duplicated across
 * the per-country rows, so "the one that is filled in" is both deterministic
 * and the one an operator meant. Ties break on `createdAt` so the answer cannot
 * move between reads.
 */
async function readIdentityRow() {
  const rows = await prisma.settings.findMany({
    select: {
      country: true,
      companyName: true,
      companyAddress: true,
      businessId: true,
      vatId: true,
      contactEmail: true,
      contactPhone: true,
      vat: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.find((r) => (r.vatId ?? '').trim() !== '') ?? rows[0] ?? null
}

/**
 * The platform issuer for an INVOICE. Throws rather than substituting a
 * placeholder.
 *
 * Called on the invoice-writing path, where the alternative to throwing is a
 * document that names a company which does not exist, carrying no tax id, in a
 * hash chain that then certifies it. Failing the payment's invoicing step is
 * recoverable — reconciliation retries it once an admin fills the field in.
 */
export async function requirePlatformIssuer(): Promise<BusinessEntity> {
  const row = await readIdentityRow()

  const companyName = (row?.companyName ?? '').trim()
  const vatId = (row?.vatId ?? '').trim()

  if (!companyName || !vatId) {
    throw new Error(
      'Platform business entity is not configured: a company name and tax id are ' +
        'required to issue a PLATFORM invoice. Set them in admin → Platform.',
    )
  }

  return {
    companyName,
    companyAddress: row?.companyAddress || DEFAULTS.companyAddress,
    businessId: row?.businessId || DEFAULTS.businessId,
    vatId,
    contactEmail: row?.contactEmail || DEFAULTS.contactEmail,
    contactPhone: row?.contactPhone || DEFAULTS.contactPhone,
    vatRate: row?.vat ?? DEFAULTS.vatRate,
  }
}

/**
 * Refuse to ISSUE with a placeholder identity.
 *
 * Pure, so it can guard the moment a PLATFORM invoice is about to be written
 * without costing a second query. Deliberately NOT applied to cash receipts or
 * partner invoices: those carry the PARTNER's identity, and a missing platform
 * entity is no reason to stop a venue selling a sunbed.
 */
export function assertPlatformIssuable(entity: BusinessEntity): void {
  const named = entity.companyName.trim() !== '' && entity.companyName !== DEFAULTS.companyName
  const identified = entity.vatId.trim() !== ''
  if (!named || !identified) {
    throw new Error(
      'Refusing to issue a PLATFORM invoice: the platform business entity has no ' +
        'company name or tax id configured. Set them in admin → Platform. ' +
        '(PLATFORM-2026-00001 was issued with the placeholder identity before this guard existed.)',
    )
  }
}

export async function getBusinessEntity(): Promise<BusinessEntity> {
  const settings = await readIdentityRow()
  return buildDisplayEntity(settings)
}

function buildDisplayEntity(
  settings: Awaited<ReturnType<typeof readIdentityRow>>,
): BusinessEntity {
  return {
    companyName: settings?.companyName || DEFAULTS.companyName,
    companyAddress: settings?.companyAddress || DEFAULTS.companyAddress,
    businessId: settings?.businessId || DEFAULTS.businessId,
    vatId: settings?.vatId || DEFAULTS.vatId,
    contactEmail: settings?.contactEmail || DEFAULTS.contactEmail,
    contactPhone: settings?.contactPhone || DEFAULTS.contactPhone,
    vatRate: settings?.vat ?? DEFAULTS.vatRate,
  }
}
