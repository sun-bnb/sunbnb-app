'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function updateReservation(
  reservation: {
    id: string,
    status: string
  }) {
  
  const session = await auth()
  console.log('SAVE RES', session, reservation)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData = {
    status: reservation.status
  }

  console.log('UPDATE RES', reservationData)
  const newReservation = await prisma.reservation.update({ where: { id: reservation.id },
    data: reservationData
  })

  const savedReservation = await prisma.reservation.findUnique({ 
    where: { id: reservation.id },
    include: {
      items: true
    }
  })

  if (reservation.status === 'confirmed') {

    const site = await prisma.site.findUnique({
      where: { id: savedReservation?.siteId }
    })

    const partnerAccount = await prisma.partnerAccount.findUnique({
      where: { userId: site?.userId }
    })

    const totalFinalAmount = savedReservation?.paymentAmount ?? 0
    const vatRate = site?.vat ?? 0

    const totalBaseAmount = totalFinalAmount / (1 + vatRate / 100)
    const totalVatAmount = totalFinalAmount - totalBaseAmount

    const invoice = await prisma.invoice.create({
      data: {
        accountId: partnerAccount?.userId!,
        totalCharge: totalBaseAmount,
        totalTax: totalVatAmount,
        totalAmount: totalFinalAmount
      }
    })

    const invoiceLines = savedReservation?.items.map(item => {

      const finalAmount = item.price ?? site?.price ?? 0

      const baseAmount = finalAmount / (1 + vatRate / 100)
      const vatAmount = finalAmount - baseAmount

      return {
        charge: baseAmount,
        tax: vatAmount,
        amount: finalAmount,
        invoiceId: invoice.id
      }

    })

    if (invoiceLines) {
      
      await prisma.invoiceLine.createMany({
        data: invoiceLines
      })

      await prisma.reservation.update({ where: { id: reservation.id },
        data: { status: 'paid' }
      })

    }
    
  }

  console.log('NEW RES', newReservation)

  return { status: 'ok', id: newReservation.id }
  
}