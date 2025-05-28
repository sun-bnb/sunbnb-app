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
    orderId,
    paymentAmount
  } = await request.json()


  console.log('initial payment amount', paymentAmount)

  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) {
    return Response.json('Order not found', { status: 404 })
  }

  if (order.paymentRef) {
    return Response.json('Payment intent already created', { status: 400 })
  }
  
  let amount = Math.round(paymentAmount * 100)
  console.log('Creating payment intent for order', orderId, 'amount', paymentAmount, amount)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: 'eur',
    automatic_payment_methods: {
      enabled: true
    }
  })

  if (paymentIntent) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'processing'
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