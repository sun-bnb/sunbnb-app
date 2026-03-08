import prisma from '@repo/data/PrismaCient'
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

export default async function Receipt({ params }: { params: { id: string } }) {
  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  const partnerInvoice = reservation.invoices.find((i) => i.issuerType === 'PARTNER')
  const platformInvoice = reservation.invoices.find((i) => i.issuerType === 'PLATFORM')

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

  const reservationFrom = reservation.from.toISOString().substring(0, 10)
  const reservationTo = reservation.to.toISOString().substring(0, 10)
  const reservationDate =
    reservationFrom === reservationTo
      ? reservationFrom
      : `${reservationFrom} – ${reservationTo}`

  const partnerSection = buildSection(
    partnerInvoice,
    partnerAccount?.company ?? 'Partner',
    partnerAccount?.phoneNumber
  )

  const platformSection = platformInvoice
    ? buildSection(platformInvoice, 'SunBnB')
    : null

  const grandTotal =
    partnerInvoice.totalAmount + (platformInvoice?.totalAmount ?? 0)

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
