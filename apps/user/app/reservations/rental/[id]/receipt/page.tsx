import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import ReceiptPage, { ReceiptProps, InvoiceSection } from '@/app/reservations/[id]/receipt/ReceiptPage'

async function getRentalBooking(id: string) {
  return prisma.rentalBooking.findUnique({
    where: { id },
    include: {
      site: {
        include: {
          user: {
            include: {
              partnerAccount: true,
            },
          },
        },
      },
      rentalItem: { select: { id: true, name: true, category: true } },
    },
  })
}

/**
 * Extract country code from a service fee description like "Equipment rental service fee (FI)".
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

export default async function RentalReceipt({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return <div>Not authorized</div>

  const booking = await getRentalBooking(params.id)
  if (!booking) return <div>Booking not found</div>
  if (booking.userId !== session.user.id) return <div>Not authorized</div>

  if (!booking.paymentRef) {
    return <div>No payment record found</div>
  }

  // Look up invoices by paymentRef
  const invoices = await prisma.invoice.findMany({
    where: { paymentRef: booking.paymentRef },
    include: { invoiceLines: true },
  })

  const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')
  const platformInvoice = invoices.find((i) => i.issuerType === 'PLATFORM')

  if (!partnerInvoice) {
    return <div>Invoice not found</div>
  }

  const { partnerAccount } = booking.site.user

  const date =
    partnerInvoice.invoicedAt.toISOString().substring(0, 10) +
    ' ' +
    partnerInvoice.invoicedAt.toISOString().substring(11, 19)

  const fromDate = booking.from.toISOString().substring(0, 10)
  const toDate = booking.to.toISOString().substring(0, 10)
  const rentalDate = fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`

  const partnerSection = buildSection(
    partnerInvoice,
    partnerAccount?.company ?? 'Partner',
    partnerAccount?.phoneNumber
  )

  const platformSection = platformInvoice
    ? buildSection(platformInvoice, 'Sunbnb')
    : null

  const grandTotal =
    partnerInvoice.totalAmount + (platformInvoice?.totalAmount ?? 0)

  const receipt: ReceiptProps = {
    date,
    siteName: booking.site?.name ?? null,
    reservationDate: rentalDate,
    seatNumbers: null,
    partnerSection,
    platformSection,
    grandTotal,
  }

  return <ReceiptPage receipt={receipt} />
}
