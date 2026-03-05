'use client'

import logger from '@/utils/logger'

import Image from 'next/image'
import LaunchIcon from '@mui/icons-material/Launch'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import CircularProgress from '@mui/material/CircularProgress'
import { useTranslations } from 'next-intl'
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
  complete: {
    text: 'PAID',
    textColor: '#118811',
    bgColor: '#eeffee',
    borderColor: '#118811'
  },
  reserved: {
    text: 'RESERVED',
    textColor: '#1e40af',
    bgColor: '#eff6ff',
    borderColor: '#3b82f6'
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

  const ts = useTranslations('Reservations')

  return (
    <div className={`
      flex border
      px-3 py-1 rounded-lg`} style={{
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
            ts(statusMap?.text) :
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

  const t = useTranslations('Reservation')

  logger.debug('Reservation confirmation', reservation)

  const opts: Intl.DateTimeFormatOptions = {
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
  }
  
  // “en-CA” emits “YYYY-MM-DD” ordering:
  const validFrom = new Date(reservation.from)
    .toLocaleDateString('en-CA', opts)
  const validTo   = new Date(reservation.to)
    .toLocaleDateString('en-CA', opts)
  
  const validity = validFrom === validTo 
    ? validFrom 
    : `${validFrom} – ${validTo}`
    
  const isUnpaid = reservation.status === 'complete' && !reservation.paymentAmount
  let status = isUnpaid ? 'reserved' : reservation.status

  const ticket = (  
    <div className="relative">
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
      <div className="w-full pt-12">
        <div className="text-center text-2xl w-full flex justify-center">
          <div className="text-brand-gold mt-6 font-semibold tracking-tight">
            { reservation.site?.name }
          </div>
        </div>
        <div className="flex mx-3 mt-12">
          <div className="w-full flex justify-center">
            <div className="text-brand-gold">
              {t('SEATS')}: <b>{reservation.items?.map(item => String(item.number)).join(', ')}</b>
            </div>
          </div>
        </div>
        <div className="flex mx-3 mt-3">
          <div className="w-full">
            <div>
              <ReservationStatus status={processingStatus || status} />
            </div>
          </div>
          {
            (status === 'paid' || status === 'complete' || status === 'reserved') && (
              <div className="relative text-brand-gold cursor-pointer -mt-[10px] -mr-2" 
                onClick={() => window.open(`/reservations/${reservation.id}/pass`, '_blank')}>
                <QrCode2Icon style={{
                  fontSize: '85px'
                }}>
                </QrCode2Icon>
                <LaunchIcon className="absolute bg-brand-cyan top-[27px] left-[27px] border border-cream text-cream border-2" sx={{ 
                  width: '30px',
                  height: '30px' 
                }}/>
              </div>
            )
          }
          
        </div>
        <div className="flex justify-between mt-1 text-brand-gold border border-brand-gold mx-3 rounded">
          <div className="bg-cream text-brand-gold pl-2">
            {t('VALID')}:
          </div>
          <div className="bg-brand-gold text-cream pr-2 pl-2">
            <b>{validity}</b>
          </div>
        </div>
        {
          (status === 'paid' || status === 'complete') && !isUnpaid && (
            <div className="
              flex
              justify-center
              text-brand-gold
              mt-16
              cursor-pointer"
              >
              
              <div className="flex border border-brand-gold px-3 rounded-lg hover:bg-cream-dark"
                
                onClick={() => window.open(`/reservations/${reservation.id}/receipt`, '_blank')}>
                <div className="text-brand-gold mr-1">{t('Open receipt')}</div>
                <LaunchIcon className="bg-cream text-brand-gold mt-0.5" sx={{ 
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
    <div id="payment-status" className="bg-cream">
      { ticket }
      {
        status === 'blah' &&
          <div className="bg-brand-cyan fixed bottom-0 h-[70px] w-full text-cream text-[24px] flex justify-center items-center">
            FOOD AND DRINK ORDERS
          </div>
      }
    </div>
  );

}