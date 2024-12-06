import prisma from '@repo/data/PrismaCient'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

export async function POST(request: NextRequest) {

  const { STRIPE_SECRET_KEY } = process.env
  if (!STRIPE_SECRET_KEY) {
    return Response.json('STRIPE_SECRET_KEY is not set', { status: 500 })
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  const {
    reservationId,
    paymentAmount
  } = await request.json()


  console.log('payment amount', paymentAmount)

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } })
  if (!reservation) {
    return Response.json('Reservation not found', { status: 404 })
  }

  if (reservation.paymentRef) {
    return Response.json('Payment intent already created', { status: 400 })
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: paymentAmount * 100,
    currency: 'eur',
    automatic_payment_methods: {
      enabled: true
    }
  })

  if (paymentIntent) {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: 'confirmed'
      }
    })
  } else {
    return Response.json('Payment intent not created', { status: 500 })
  }

  return Response.json({
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    dpmCheckerLink: `https://dashboard.stripe.com/settings/payment_methods/review?transaction_id=${paymentIntent.id}`
  })
  
}