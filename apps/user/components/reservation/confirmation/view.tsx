'use client'

import logger from '@/utils/logger'

import Image from 'next/image'
import LaunchIcon from '@mui/icons-material/Launch'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import CircularProgress from '@mui/material/CircularProgress'
import { Reservation } from '@/app/sites/types'
import sunbedIcon from './sunbed-icon-transparent.png'

const STATUS_CONTENT_MAP: {
  [key: string]: {
    text: string
    textColor: string
    bgColor: string
    borderColor: string
  }
} = {
  succeeded: {
    text: 'Payment received',
    textColor: '#118811',
    bgColor: '#eeffee',
    borderColor: '#118811'
  },
  paid: {
    text: 'PAID',
    textColor: '#118811',
    bgColor: '#eeffee',
    borderColor: '#118811'
  },
  processing: {
    text: 'Processing',
    textColor: '#111188',
    bgColor: '#eeeeff',
    borderColor: '#111188'
  },
  confirmed: {
    text: 'Confirmed',
    textColor: '#111188',
    bgColor: '#eeeeff',
    borderColor: '#111188'
  },
  default: {
    text: 'Pending',
    textColor: '#111111',
    bgColor: '#eeeeee',
    borderColor: '#111111'
  },
  pending: {
    text: 'Pending',
    textColor: '#111111',
    bgColor: '#eeeeee',
    borderColor: '#111111'
  },
  payment_failed: {
    text: 'Payment failed',
    textColor: '#aa3333',
    bgColor: '#ffcccc',
    borderColor: '#aa3333'
  }
}

function ReservationStatus ({
  status
} : {
  status: string
}) {

  const statusMap = STATUS_CONTENT_MAP[status]


  return (
    <div className={
      `flex border border-[1px]
      px-[12px] py-[2px] rounded-[6px]`} style={{
        backgroundColor: statusMap?.bgColor,
        color: statusMap?.textColor,
        borderColor: statusMap?.borderColor,
      }}>
      <div>
        <Image src={sunbedIcon} alt="Sunbed icon" style={{
          width: '75px',
          height: '60px',
          marginLeft: '-10px',
          padding: '0px'
        }} />
      </div>
      <div className="flex justify-center items-center flex-grow">
        {
          status !== 'processing' ? 
            statusMap?.text :
            <CircularProgress />
                        
        }
      </div>

    </div>
  )

}

export default function ReservationConfirmationView({
  reservation,
  processingStatus
} : {
  reservation: Reservation,
  processingStatus?: string
}) {

  logger.debug('Reservation confirmation', reservation)
  const validFrom = new Date(reservation.from).toISOString().substring(0, 10)
  const validTo = new Date(reservation.to).toISOString().substring(0, 10)

  let status = reservation.status

  const validity = validFrom === validTo ? validFrom : `${validFrom} - ${validTo}`

  const ticket = (  
    <div className="relative h-screen">
      {
        
          !reservation &&
            <div className="
                absolute
                top-[6px]
                left-1/2
                -translate-x-1/2
                inline-block
                z-[1]
                py-[6px]
                px-[8px]
                w-[80%]
            ">
              
            </div>
      }
      <div className="w-full pt-[52px]">
        <div className="text-center text-2xl w-full flex justify-center">
          <div className="text-[rgb(142,114,49)] mt-[24px]">
            { reservation.site?.name }
          </div>
        </div>
        <div className="flex mx-[12px] mt-[48px]">
          <div className="w-full flex justify-center">
            <div className="text-[rgb(142,114,49)] pl-[8px]">
              SEATS: <b>{reservation.items?.map(item => String(item.number)).join(', ')}</b>
            </div>
          </div>
        </div>
        <div className="flex mx-[12px] mt-[12px]">
          <div className="w-full">
            <div>
              <ReservationStatus status={processingStatus || status} />
            </div>
          </div>
          {
            status === 'paid' && (
              <div className="relative text-[rgb(142,114,49)] cursor-pointer -mt-[10px] -mr-[8px]" 
                onClick={() => window.open(`/reservations/${reservation.id}/pass`, '_blank')}>
                <QrCode2Icon style={{
                  fontSize: '85px'
                }}>
                </QrCode2Icon>
                <LaunchIcon className="absolute bg-[#00cef1] top-[27px] left-[27px] border border-[#fff5e1] text-[#fff5e1] border-[2px]" sx={{ 
                  width: '30px',
                  height: '30px' 
                }}/>
              </div>
            )
          }
          
        </div>
        <div className="flex justify-between mt-[4px] text-[rgb(142,114,49)] border border-[rgb(142,114,49)] mx-[12px]">
          <div className="bg-[#fff5e1] text-[rgb(142,114,49)] pl-[6px]">
            VALID:
          </div>
          <div className="bg-[rgb(142,114,49)] text-[#fff5e1] pr-[6px] pl-[6px]">
            <b>{validity}</b>
          </div>
        </div>
        {
          status === 'paid' && (
            <div className="
              flex
              justify-center
              text-[rgb(142,114,49)]
              mt-[72px]
              cursor-pointer"
              >
              
              <div className="flex border border-[rgb(142,114,49)] px-[12px]" style={{
                borderRadius: '6px'
              }}
                
                onClick={() => window.open(`/reservations/${reservation.id}/receipt`, '_blank')}>
                <div className="text-[rgb(142,114,49)] mr-[4px]">Open receipt</div>
                <LaunchIcon className="bg-[#fff5e1] text-[rgb(142,114,49)] mt-[2px]" sx={{ 
                  width: '20px',
                  height: '20px' 
                }}/>
              </div>
            </div>
          )
        }
        
      </div>
    </div>
  )

  return (
    <div id="payment-status" className="bg-[#fff5e1]">
      { ticket }
      {
        status === 'blah' &&
          <div className="bg-[#00cef1] fixed bottom-0 h-[70px] w-full text-[#fff5e1] text-[24px] flex justify-center items-center">
            FOOD AND DRINK ORDERS
          </div>
      }
    </div>
  );

}