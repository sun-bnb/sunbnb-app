import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReceiptPage, { ReceiptProps, InvoiceSection } from './ReceiptPage'

async function getReservation(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    include: {
      items: true,
      site: {
        include: {
          user: {
            include: {
              partnerAccount: true,
            },
          },
        },
      },
      invoices: {
        include: {
          invoiceLines: true,
        },
      },
    },
  })
}

async function getOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      site: {
        include: {
          user: {
            include: {
              partnerAccount: true,
            },
          },
        },
      },
      invoices: {
        include: {
          invoiceLines: true,
        },
      },
    },
  })
}

/**
 * Extract country code from a service fee description like "Reservation service fee (FI)".
 */
function extractCountryCode(lines: { description: string | null }[]): string | null {
  for (const line of lines) {
    const match = line.description?.match(/\(([A-Z]{2,3})\)\s*$/)
    if (match) return match[1]!
  }
  return null
}

function buildSection(invoice: {
  invoiceNumber: string | null
  issuerCompanyName: string | null
  issuerVatNumber: string | null
  issuerCompanyAddress: string | null
  totalCharge: number
  totalTax: number
  totalAmount: number
  invoiceLines: {
    description: string | null
    charge: number
    vatRate: number | null
    tax: number
    amount: number
  }[]
}, fallbackName: string, fallbackPhone?: string | null): InvoiceSection {
  return {
    invoiceNumber: invoice.invoiceNumber,
    merchantName: invoice.issuerCompanyName ?? fallbackName,
    merchantVatId: invoice.issuerVatNumber,
    merchantAddress: invoice.issuerCompanyAddress,
    merchantPhone: fallbackPhone ?? null,
    vatCountryCode: extractCountryCode(invoice.invoiceLines),
    lines: invoice.invoiceLines.map((l) => ({
      description: l.description,
      charge: l.charge,
      vatRate: l.vatRate,
      vat: l.tax,
      total: l.amount,
    })),
    subtotalCharge: invoice.totalCharge,
    subtotalVat: invoice.totalTax,
    subtotalAmount: invoice.totalAmount,
  }
}

export default async function Receipt({ params, searchParams }: { params: { id: string }, searchParams: { [key: string]: string } }) {
  const { orderId, anonId: anonIdParam } = searchParams

  // ── Verify ownership ─────────────────────────────────────────────────────
  const session = await auth()

  // ── Order receipt ──────────────────────────────────────────────────────────
  if (orderId) {
    const order = await getOrder(orderId)

    if (!order) {
      return <div>Order not found</div>
    }

    // Ownership check
    if (session?.user?.id) {
      if (order.userId !== session.user.id) {
        return <div>Not authorized</div>
      }
    } else {
      if (!anonIdParam || order.anonId !== anonIdParam) {
        return <div>Not authorized</div>
      }
    }

    const partnerInvoice = order.invoices.find((i) => i.issuerType === 'PARTNER')

    if (!partnerInvoice) {
      return <div>Invoice not found</div>
    }

    const { partnerAccount } = order.site.user

    const date =
      partnerInvoice.invoicedAt.toISOString().substring(0, 10) +
      ' ' +
      partnerInvoice.invoicedAt.toISOString().substring(11, 19)

    const partnerSection = buildSection(
      partnerInvoice,
      partnerAccount?.company ?? 'Partner',
      partnerAccount?.phoneNumber
    )

    const platformSection = null

    const grandTotal = partnerInvoice.totalAmount

    const receipt: ReceiptProps = {
      date,
      siteName: order.site?.name ?? null,
      reservationDate: null,
      seatNumbers: null,
      partnerSection,
      platformSection,
      grandTotal,
    }

    return <ReceiptPage receipt={receipt} />
  }

  // ── Reservation receipt ────────────────────────────────────────────────────
  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  // Ownership check
  if (session?.user?.id) {
    if (reservation.userId !== session.user.id) {
      return <div>Not authorized</div>
    }
  } else {
    if (!anonIdParam || reservation.anonId !== anonIdParam) {
      return <div>Not authorized</div>
    }
  }

  const partnerInvoice = reservation.invoices.find((i) => i.issuerType === 'PARTNER')

  if (!partnerInvoice) {
    console.error('Partner invoice not found')
    return <div>Invoice not found</div>
  }

  const { partnerAccount } = reservation.site.user

  const date =
    partnerInvoice.invoicedAt.toISOString().substring(0, 10) +
    ' ' +
    partnerInvoice.invoicedAt.toISOString().substring(11, 19)

  const seatNumbers =
    reservation.items?.map((item) => String(item.number)).join(', ') ?? null

  // from/to are stored as UTC from startOf/endOf('day') in the user's local timezone.
  // Adding 12h to from and subtracting 12h from to normalises both to the correct
  // calendar date regardless of UTC offset (covers UTC-12 to UTC+12).
  const halfDay = 12 * 60 * 60 * 1000
  const reservationFrom = new Date(reservation.from.getTime() + halfDay).toISOString().substring(0, 10)
  const reservationTo = new Date(reservation.to.getTime() - halfDay).toISOString().substring(0, 10)
  const reservationDate =
    reservationFrom === reservationTo
      ? reservationFrom
      : `${reservationFrom} – ${reservationTo}`

  const partnerSection = buildSection(
    partnerInvoice,
    partnerAccount?.company ?? 'Partner',
    partnerAccount?.phoneNumber
  )

  const platformSection = null

  const grandTotal = partnerInvoice.totalAmount

  const receipt: ReceiptProps = {
    date,
    siteName: reservation.site?.name ?? null,
    reservationDate,
    seatNumbers,
    partnerSection,
    platformSection,
    grandTotal,
  }

  return <ReceiptPage receipt={receipt} />
}
