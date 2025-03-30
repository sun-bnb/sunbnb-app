import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import Stripe from 'stripe'

import { NextRequest } from 'next/server'
import { auth } from '@/app/auth'

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