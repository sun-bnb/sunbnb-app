'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Button from '@mui/material/Button'
import { Reservation } from '@/app/sites/types'

import qrTicketImage from './qr-ticket.png'


export default function CompleteView({
  reservation
} : {
  reservation: Reservation
}) {

  const router = useRouter()
    
  const dateStr = reservation.from.toISOString().substring(0, 10)
  const itemCount = reservation.items?.length || 0

  const ticket = (
    <div>
      <div className="text-center">
        <div className="text-center">
          <table className="mx-auto w-full table-auto border-collapse">
            <tbody>
              <tr>
                <td className="px-4 text-[24px]">SEATING PASS</td>
              </tr>
              <tr>
                <td className="px-4 py-2">
                  SEATS: <b>{reservation.items?.map(item => String(item.number)).join(', ')}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="mx-auto">
        <Image src={qrTicketImage} alt="Item" />
      </div>
      <div className="text-center ml-[20px] mr-[20px]">
        <Button fullWidth={true} variant="outlined" onClick={() => router.push(`/reservations/${reservation.id}`)}>
          PRINT
        </Button>
      </div>
      <div className="text-center mt-4 ml-[20px] mr-[20px]">
        {
          reservation && (
            <div className="text-center">
              <table className="mx-auto w-full table-auto border-collapse border border-gray-300">
                <tbody>
                  <tr>
                    <td className="border px-4">QUANTITY</td>
                    <td className="border px-4">VALID</td>
                  </tr>
                  <tr>
                    <td className="border px-4 py-2"><b>{itemCount}</b></td>
                    <td className="border px-4 py-2"><b>{dateStr}</b></td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4">
                <div>PAID: {reservation.paymentAmount} €</div>
              </div>
            </div>
          )
        }
      </div>
    </div>
  )

  return (
    <div id="payment-status" className="m-[6px]">
      { ticket }
    </div>
  );
}