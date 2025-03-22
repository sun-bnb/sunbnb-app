'use client'

import { useState, useEffect } from 'react'
import { Stripe, loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'

import ReceiptView from './ReceiptView'
import { useGetReservationByIdQuery } from '@/store/features/api/apiSlice'
import { Reservation } from '@/app/sites/types'


export default function ReceiptPage({ 
  reservation
} : { 
  reservation: Reservation
}) {
  return (
    <div className="App">
      <ReceiptView reservation={reservation} />
    </div>
  )

}