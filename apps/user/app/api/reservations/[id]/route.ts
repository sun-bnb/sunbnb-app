import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { Prisma, ServiceFee } from '@prisma/client'
import Stripe from 'stripe'

import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

function round(amount: number) {
  return Math.round(amount * 100) / 100
}

function computeVatAndBaseAmounts(finalAmount: number, vatRate: number) {
  const baseAmount = round(finalAmount / (1 + vatRate / 100))
  const vatAmount = round(finalAmount - baseAmount)
  return { baseAmount, vatAmount }
}

function findServiceFee(
  site: any,
  partnerAccount: any,
  settings: any,
  serviceCode: string
): ServiceFee | undefined {
  return (
    site?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    partnerAccount?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode) ||
    settings?.serviceFees?.find((fee: any) => fee.serviceCode === serviceCode)
  )
}

async function handleConfirmedReservation(reservation: any) {

  let [site, partnerAccount, settings] = await Promise.all([
    prisma.site.findUnique({
      where: { id: reservation.siteId },
      include: { serviceFees: true },
    }),
    prisma.partnerAccount.findUnique({
      where: { userId: reservation.site.userId },
      include: { serviceFees: true },
    }),
    prisma.settings.findFirst({
      include: { serviceFees: true },
    }),
  ])

  if (!settings) {
    
    await prisma.settings.create({
      data: {
        country: 'FI',
        currency: 'EUR',
        vat: 25.5
      }
    })
    
    settings = await prisma.settings.findFirst({
      include: { serviceFees: true },
    })

    await prisma.serviceFee.create({
      data: {
        settingsId: settings?.id!,
        serviceCode: 'sunbed-rental',
        chargeType: 'fixed',
        feeAmount: 1.00
      }
    })

  }

  const SERVICE_CODE = 'sunbed-rental';
  const matchedServiceFee = findServiceFee(site, partnerAccount, settings, SERVICE_CODE);

  logger.debug('MATCHED SERVICE FEE', matchedServiceFee)

  const totalFinalAmount = reservation.paymentAmount ?? 0;
  const vatRate = site?.vat ?? 0;
  const { baseAmount: totalBaseAmount, vatAmount: totalVatAmount } = 
    computeVatAndBaseAmounts(totalFinalAmount, vatRate);

  const invoice = await prisma.invoice.create({
    data: {
      accountId: partnerAccount?.userId || '',
      totalCharge: totalBaseAmount,
      totalTax: totalVatAmount,
      totalAmount: totalFinalAmount,
    },
  })

  let invoiceLines = reservation.items.map((item: any) => {

    const finalAmount = item.price ?? site?.price ?? 0;
    const serviceFeeAmount = matchedServiceFee?.chargeType === 'fixed' ?
      matchedServiceFee?.feeAmount : matchedServiceFee?.percentage! * finalAmount
    const itemAmount = finalAmount - (serviceFeeAmount || 0)

    const { baseAmount: itemBaseAmount, vatAmount: itemVatAmount } = computeVatAndBaseAmounts(itemAmount, vatRate);
    const { baseAmount: serviceBaseAmount, vatAmount: serviceVatAmount } = computeVatAndBaseAmounts(serviceFeeAmount || 0, vatRate);

    return [
      {
        charge: itemBaseAmount,
        tax: itemVatAmount,
        amount: itemAmount,
        invoiceId: invoice.id,
        productCode: 'sunbed-rental',
        description: `Sunbed ${item.number} (${item.category})`
      },
      {
        charge: serviceBaseAmount,
        tax: serviceVatAmount,
        amount: serviceFeeAmount,
        invoiceId: invoice.id,
        productCode: 'sunbnb-service-fee',
        description: `Res. fee`
      }
    ]

  });

  invoiceLines = invoiceLines.flat()

  if (invoiceLines.length > 0) {
    await prisma.invoiceLine.createMany({ data: invoiceLines });
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        invoiceId: invoice.id,
        status: 'complete'
      },
    });
  }
}

async function getPaymentIntentStatus(paymentRef: string) {

  const { STRIPE_SECRET_KEY } = process.env
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY)
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef)

  return paymentIntent.status

}

export async function GET(request: NextRequest, { params } : { params: { id: string } }) {

  const session = await auth()
  // if (!session?.user) return Response.json({ status: 'error', errors: [ 'Not authenticated' ] })
  
  let reservation = await prisma.reservation.findUnique({ 
    where: { id: params.id },
    include: {
      items: true,
      site: true
    }
  })
  console.log('RESERVATION', reservation)

  if (!reservation) {
    return Response.json({ status: 'error', errors: [ 'Reservation not found' ] })
  }

  if (reservation.status === 'processing' && reservation.paymentRef) {
    
    const paymentStatus = await getPaymentIntentStatus(reservation.paymentRef)

    console.log('PAYMENT STATUS', paymentStatus)

    if (paymentStatus === 'succeeded') {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'paid' } })
      await handleConfirmedReservation(reservation)
    } else if (paymentStatus !== 'processing') {
      await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'payment_failed' } })
    }

    if (paymentStatus !== 'processing') {
      reservation = await prisma.reservation.findUnique({
        where: { id: params.id },
        include: {
          items: true,
          site: true
        }
      })
    }

  }

  

  return Response.json(reservation)

}