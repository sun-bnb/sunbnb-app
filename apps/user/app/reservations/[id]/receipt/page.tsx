import prisma from '@repo/data/PrismaCient'
import ReceiptPage, { ReceiptProps } from './ReceiptPage'

interface SearchParams {
  searchParams: { [key: string]: string }
}

async function getReservation(id: string) {

  console.log('GET RESERVATION BY ID', id)
  const reservation = await prisma.reservation.findUnique({ 
    where: { id },
    include: {
      items: true,
      site: {
        include: {
          user: {
            include: {
              partnerAccount: true
            }
          }
        }
      },
      invoice: {
        include: {
          invoiceLines: true
        }
      }
    }
  })

  console.log('RESERVATION FOUND', reservation)
  return reservation

}

export default async function Receipt({ params }: { params: { id: string } }) {

  const reservation = await getReservation(params.id)

  if (!reservation) {
    console.error('Reservation not found')
    return <div>Reservation not found</div>
  }

  const { partnerAccount } = reservation.site.user
  const { invoice } = reservation

  if (!partnerAccount || !invoice) {
    console.error('Partner account or invoice not found')
    return <div>Partner account or invoice not found</div>
  }

  const { businessId, company, phoneNumber } = partnerAccount

  const { totalCharge, totalTax, totalAmount } = invoice

  const invoiceLines = reservation?.invoice?.invoiceLines.map(line => {
    return {
      description: line.description,
      charge: line.charge,
      vat: line.tax,
      total: line.amount
    }
  })

  if (!invoiceLines || invoiceLines.length === 0) {
    console.error('No invoice lines found')
    return <div>No invoice lines found</div>
  }

  const date = 
    invoice.invoicedAt.toISOString().substring(0, 10) + ' ' +
    invoice.invoicedAt.toISOString().substring(11, 19)

  const receipt: ReceiptProps = {
    date,
    businessId,
    company,
    phoneNumber,
    totalCharge,
    totalVat: totalTax,
    totalAmount,
    invoiceLines
  }

  return (
    <ReceiptPage receipt={receipt} />
  )
}