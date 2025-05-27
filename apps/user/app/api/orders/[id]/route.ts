import logger from '@/utils/logger'

import prisma from '@repo/data/PrismaCient'
import { Prisma, ServiceFee } from '@prisma/client'
import Stripe from 'stripe'

import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'
import { Order, Product } from '@/app/types/types'

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

async function handleConfirmedOrder(order: Order) {

  const orderSite = await prisma.site.findUnique({
    where: { id: order.siteId },
    include: { serviceFees: true }
  })

  let [site, partnerAccount, settings] = await Promise.all([
    prisma.site.findUnique({
      where: { id: order.siteId },
      include: { serviceFees: true },
    }),
    prisma.partnerAccount.findUnique({
      where: { userId: orderSite!.userId },
      include: { serviceFees: true },
    }),
    prisma.settings.findFirst({
      include: { serviceFees: true },
    })
  ])

  if (!settings) {
    
    await prisma.settings.create({
      data: {
        country: 'FI',
        currency: 'EUR',
        vat: 25.5,
      }
    })
    
    settings = await prisma.settings.findFirst({
      include: { serviceFees: true },
    })

    await prisma.serviceFee.create({
      data: {
        settingsId: settings?.id!,
        serviceCode: 'food-and-beverage',
        chargeType: 'fixed',
        feeAmount: 1.00
      }
    })

  }

  const SERVICE_CODE = 'food-and-beverage';
  let matchedServiceFee = findServiceFee(site, partnerAccount, settings, SERVICE_CODE);

  if (!matchedServiceFee) {

    await prisma.serviceFee.create({
      data: {
        settingsId: settings?.id!,
        serviceCode: 'food-and-beverage',
        chargeType: 'fixed',
        feeAmount: 1.00
      }
    })

    settings = await prisma.settings.findFirst({
        include: { serviceFees: true }
    })

    matchedServiceFee = findServiceFee(site, partnerAccount, settings, SERVICE_CODE);

  }

  logger.debug('MATCHED SERVICE FEE', matchedServiceFee)

  const totalFinalAmount = order.paymentAmount ?? 0;
  const vatRate = site?.vat ?? 0;
  const { baseAmount: totalBaseAmount, vatAmount: totalVatAmount } = 
    computeVatAndBaseAmounts(totalFinalAmount, vatRate);

  
  const serviceFeeAmount = matchedServiceFee?.chargeType === 'fixed' ?
    (matchedServiceFee?.feeAmount || 0) : matchedServiceFee?.percentage! * totalFinalAmount

  const { baseAmount: serviceBaseAmount, vatAmount: serviceVatAmount } = computeVatAndBaseAmounts(serviceFeeAmount || 0, vatRate);


  const invoice = await prisma.invoice.create({
    data: {
      accountId: partnerAccount?.userId || '',
      totalCharge: totalBaseAmount,
      totalTax: totalVatAmount,
      totalAmount: totalFinalAmount + serviceFeeAmount
    },
  })

  let invoiceLines = order.orderItems.map((item) => {

    const finalAmount = item.totalPrice;
    //const serviceFeeAmount = matchedServiceFee?.chargeType === 'fixed' ?
    //  (matchedServiceFee?.feeAmount || 0) : matchedServiceFee?.percentage! * finalAmount
    const serviceFeeAmount = 0
    const itemAmount = finalAmount - (serviceFeeAmount || 0)

    const { baseAmount: itemBaseAmount, vatAmount: itemVatAmount } = computeVatAndBaseAmounts(itemAmount, item.tax);
    
    return [
      {
        charge: itemBaseAmount,
        tax: itemVatAmount,
        amount: itemAmount,
        invoiceId: invoice.id,
        productCode: 'food-and-beverage',
        description: `${item.name} x (${item.quantity})`
      }
    ]

  });

  const finalInvoiceLines = invoiceLines.flat()

  const serviceFeeLine = {
    charge: serviceBaseAmount,
    tax: serviceVatAmount,
    amount: serviceFeeAmount,
    invoiceId: invoice.id,
    productCode: 'sunbnb-service-fee',
    description: `Srv. fee`
  }

  finalInvoiceLines.push(serviceFeeLine)

  if (invoiceLines.length > 0) {
    await prisma.invoiceLine.createMany({ data: finalInvoiceLines });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        invoiceId: invoice.id,
        status: 'paid'
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
  
  let order = await prisma.order.findUnique({ 
    where: { id: params.id },
    include: {
      orderItems: true,
      site: true
    }
  })
  console.log('ORDER', order)

  if (!order) {
    return Response.json({ status: 'error', errors: [ 'Reservation not found' ] })
  }

  if (order.status === 'processing' && order.paymentRef) {
    
    const paymentStatus = await getPaymentIntentStatus(order.paymentRef)

    console.log('PAYMENT STATUS', paymentStatus)

    if (paymentStatus === 'succeeded') {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } })
      await handleConfirmedOrder(order)
    } else if (paymentStatus !== 'processing') {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'payment_failed' } })
    }

    if (paymentStatus !== 'processing') {
      order = await prisma.order.findUnique({ 
        where: { id: params.id },
        include: {
          orderItems: true,
          site: true
        }
      })
    }

  }

  

  return Response.json(order)

}