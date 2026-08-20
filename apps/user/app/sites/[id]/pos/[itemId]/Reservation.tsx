'use client'

import logger from '@/utils/logger'

import { v4 as uuidv4 } from 'uuid'
import Image from 'next/image'
import { InventoryItem, SiteProps } from '@/app/sites/types'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CheckIcon from '@mui/icons-material/Check'
import BlockIcon from '@mui/icons-material/Block'
import CircularProgress from '@mui/material/CircularProgress'
import React, { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import {
  useGetReservationByIdQuery
} from '@/store/features/api/apiSlice'
import { saveReservationForMultipleItems } from '../../actions'
import { RESERVATION_PROCESSING } from '@repo/data/reservation-status'
import PaymentView from '@/app/payment/Payment'
import sunbedIcon from './sunbed-icon-transparent.png'
import sunbedPerfIcon from '@/components/reservation/sunbed-perforated-transparent.png'
import sunshadeIcon from '@/components/reservation/sunshade-transparent.png'
import beachTowelIcon from '@/components/reservation/beach-towel-transparent.png'
import { useRouter } from 'next/navigation'
import { formatSeatId } from '@repo/data/seat-label'
import {
  canPickSeats,
  initialSeatSelection,
  selectionPrice,
  toggleSeatId,
  unitIsSellable,
} from './pos-seat-selection'


function ReservationButton({
  disabled,
  items,
  site,
  dateRange
}: {
  disabled: boolean,
  items: InventoryItem[],
  site: SiteProps,
  dateRange: { from: string, to: string }
}) {

  const { data: session } = useSession()

  const dispatch = useDispatch();
  const router = useRouter()
  const sitesState = useSelector((state: RootState) => state.sites)

  let selectedItems = items

  return (
    <div className="mt-[8px]">
      <Button style={{
        backgroundColor: disabled ? '#bbbbbb' : 'white',
        color: disabled ? '#888888' : '#1976d2',
        height: '45px'
      }} variant="contained"
        fullWidth={true}
        disabled={disabled}
        onClick={
          async () => {
            dispatch(setValue({ reservationState: 'saving' }))
            logger.debug('Reserve ITEM', selectedItems, dateRange)

            let saveResult = null

            let anonId = undefined
            if (!(session?.user?.id)) {
              anonId = localStorage.getItem('sunbnb-anonId')
              if (!anonId) {
                anonId = uuidv4()
                localStorage.setItem('sunbnb-anonId', anonId)
              }
            }
            
            saveResult = await saveReservationForMultipleItems({
              from: dateRange.from,
              to: dateRange.to,
              type: 'days',
              siteId: items[0]!.site?.id!,
              items: selectedItems,
              userId: session?.user?.id,
              anonId
            })

            logger.debug('Save result ITEM', saveResult)
            if (saveResult?.status === 'ok' && saveResult.id) {
              dispatch(setValue({ 
                reservationState: site.type !== 'paid' ? 'complete' : 'processing',
                pendingReservationId: saveResult.id,
                panelBottom: 'bottom-[0px]'
              }))
              if (site.type !== 'paid') {
                router.push(`/reservations/${saveResult.id}`)
              }
            }

          }
        }>
          RESERVE
        </Button>
    </div>
  )
}

/**
 * The seat id, drawn on the unit illustration directly above the bed it names,
 * so a guest standing at the parasol can match a bed in the picture to the one
 * painted on it. Sits above the parasol's top edge (it starts at -25px), which
 * is why the illustration is given headroom rather than the label a backdrop.
 */
function SeatLabel({ item, className }: { item: InventoryItem; className?: string }) {
  return (
    <div
      className={`absolute top-[-52px] z-20 text-center text-lg font-semibold text-[rgb(142,114,49)] ${className ?? ''}`}
    >
      {formatSeatId(item)}
    </div>
  )
}

/**
 * One bed of the unit: the sunbed art with a towel laid over it when the seat is
 * selected. The towel is the selection indicator — a bed with a towel on it is
 * taken, which is what the guest sees on the sand — and it only appears where
 * the guest can actually choose (a site that allows partial booking, on a unit
 * with more than one bed). A seat somebody else already holds is dimmed and
 * inert: it is not the guest's to pick.
 */
function UnitBed({
  item,
  width,
  selected,
  available,
  selectable,
  onToggle,
  className,
  style,
}: {
  item: InventoryItem
  width: number
  selected: boolean
  available: boolean
  selectable: boolean
  onToggle: (item: InventoryItem) => void
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`absolute ${selectable ? 'cursor-pointer' : ''} ${available ? '' : 'opacity-40'} ${className ?? ''}`}
      style={{ width: `${width}px`, ...style }}
      onClick={() => selectable && onToggle(item)}
      role={selectable ? 'button' : undefined}
      aria-pressed={selectable ? selected : undefined}
      aria-label={selectable ? `Seat ${formatSeatId(item)}` : undefined}
    >
      <Image src={sunbedPerfIcon} alt="Sunbed" width={width} />
      {selected && (
        <Image
          src={beachTowelIcon}
          alt="Towel"
          width={Math.round(width * 0.85)}
          style={{
            position: 'absolute',
            top: '34%',
            // Centred off its own width, so resizing the towel doesn't drift it
            // off the bed the way a hardcoded left offset did.
            left: '50%',
            transform: 'translateX(-50%) rotate(30deg)',
            transformOrigin: 'center',
          }}
        />
      )}
    </div>
  )
}

export default function ReservationView({
  apiKey,
  items,
  site,
  availableItemIds,
  dateRange
} : {
  apiKey: string
  items: InventoryItem[],
  site: SiteProps,
  /** Seats the canonical availability service reports free for the venue's today. */
  availableItemIds: string[],
  dateRange: { from: string, to: string }
}) {

  const dispatch = useDispatch()

  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, pendingReservationId } = sitesState

  let focused = sitesState.focused
  let panelBottom = sitesState.panelBottom || '-bottom-[364px]'

  const { data: reservation } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    skip: !pendingReservationId
  })

  logger.debug('Reservation By Id ITEM', pendingReservationId, reservation)

  // Drawn left-to-right by seat number, so a unit looks the same whichever
  // bed's QR was scanned — `items` leads with the scanned seat, which used to
  // make the second bed's QR read "SEATS 1-101-2, 1-101-1".
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => a.number - b.number),
    [items],
  )

  // Server-decided, via the canonical availability service (see ./queries.ts).
  // Absence from the list is unbookable — never treat an unknown id as free.
  const availableSet = useMemo(() => new Set(availableItemIds), [availableItemIds])

  const picking = canPickSeats(site, orderedItems)

  // The whole unit starts selected — a parasol with two beds is what the guest
  // walked up to — and clicks take beds out of the booking or put them back.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialSeatSelection(items, availableItemIds),
  )

  const toggleSeat = (item: InventoryItem) => {
    if (!picking || !availableSet.has(item.id)) return
    setSelectedIds((prev) => toggleSeatId(prev, item.id))
  }

  // Without per-seat picking the selection IS the unit, exactly as before.
  const selectedItems = picking
    ? orderedItems.filter((item) => selectedIds.includes(item.id))
    : items

  const totalPrice = selectionPrice(selectedItems, site.price)

  const dateStr = new Date().toISOString().substring(0, 10)

  const isAvailable = unitIsSellable(orderedItems, availableItemIds, picking)

  // Everything deselected is a legal state: nothing to reserve, so no price and
  // no button.
  const canReserve = isAvailable && selectedItems.length > 0

  // The towel says "this bed is in your booking" — it only means something
  // where the guest can take beds out. On a whole-unit site the art is
  // unchanged: every bed is always in the booking, so a towel on each would be
  // decoration the guest cannot act on.
  const isTowelled = (item: InventoryItem) =>
    picking && selectedItems.some((selected) => selected.id === item.id)

  const previewElem = (
    <div>
      <div className={`flex justify-between ${!reservation ? 'text-white' : 'text-black'}`}>
        <div className="flex justify-center">
          {
            !reservation ? 
              <div className="w-[200px]">
                <ReservationButton disabled={!canReserve} items={selectedItems} site={site} dateRange={dateRange} /> 
              </div>:
              <div className="block mt-[6px] ml-[6px]">
                <div className="text-left">DATE: <b>{dateStr}</b></div>
                {
                  selectedItems.length === 1 ? 
                    <div className="text-left">SEAT NUMBER: <b>{formatSeatId(selectedItems[0]!)}</b></div> :
                    <div className="text-left">SEAT NUMBERS: <b>{selectedItems.map(item => formatSeatId(item)).join(', ')}</b></div>
                }
                
              </div>
          }
          
        </div>
        {selectedItems.length > 0 && (
          <div className="text-center text-[64px] -mt-[20px]">
            {totalPrice} €
          </div>
        )}
      </div>
    </div>
  )

  const paymentElem =
    (reservationState === RESERVATION_PROCESSING || reservationState === 'payment_in_progress') ? (
      !reservation ? (
        <div className="flex justify-center mb-[12px] mt-[24px]">
          <CircularProgress />
        </div>
      ) : <PaymentView
            preview={previewElem}
            reservation={reservation}
            paymentProvider={site.paymentProvider} />

    ) : (
      <div className="mx-[4px] mt-[8px] h-[420px]">
        <div className="mt-[10px]">
          {previewElem}
        </div>
      </div>
    )
  
  const bgColor = !reservation ? 'bg-[#1976d2]' : 'bg-white'

  return (
    <div className="relative bg-[rgb(255,231,156)] h-screen">
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
      <div className="w-full">
        <div className="text-center text-2xl h-[80px] w-full flex justify-center border-b-[2px] border-[rgb(142,114,49)]">
          <div className="text-[rgb(142,114,49)] mt-[22px]">
            Chiringuito La Cepa Playa
          </div>
        </div>
        <div className="flex justify-center mt-[72px]">
          {
            orderedItems.length === 1 ?
              <div className="relative w-[300px] shrink-0">
                <SeatLabel item={orderedItems[0]!} className="left-0 w-full" />
                <Image src={sunbedIcon} alt="Sunbed icon" width={300} />
              </div> :
              <div className="relative h-[300px] w-[300px] shrink-0">
                <SeatLabel item={orderedItems[0]!} className="left-0 w-[150px]" />
                <SeatLabel item={orderedItems[1]!} className="right-0 w-[150px]" />
                <UnitBed
                  item={orderedItems[0]!}
                  width={150}
                  selected={isTowelled(orderedItems[0]!)}
                  available={availableSet.has(orderedItems[0]!.id)}
                  selectable={picking && availableSet.has(orderedItems[0]!.id)}
                  onToggle={toggleSeat}
                  style={{ top: '0px', left: '0px' }}
                />
                <UnitBed
                  item={orderedItems[1]!}
                  width={150}
                  selected={isTowelled(orderedItems[1]!)}
                  available={availableSet.has(orderedItems[1]!.id)}
                  selectable={picking && availableSet.has(orderedItems[1]!.id)}
                  onToggle={toggleSeat}
                  style={{ top: '0px', right: '0px' }}
                />
                {/* Last, so the parasol shades the beds and their towels. */}
                <Image src={sunshadeIcon} alt="Sunshade icon" width={200} className="pointer-events-none" style={{
                  position: 'absolute',
                  top: '-25px',
                  left: '50px'
                }}/>
              </div>
          }
          
        </div>
        <div className="flex justify-center mt-[6px]">
          <Alert className="w-[200px] flex justify-center" icon={
            isAvailable ? 
              <CheckIcon fontSize="inherit" /> :
              <BlockIcon fontSize="inherit" />
            } severity={ isAvailable ? 'success' : 'error' }>
            { isAvailable ? 'Available' : 'Reserved' }
          </Alert>
        </div>
      </div>
      {
        <div style={{ zIndex: 11 }} className={`fixed left-0 w-full ${bgColor} text-white text-center px-2 pb-4
          ${panelBottom} border-t transition-bottom duration-500`}>
          {
            focused ?
              <div className="text-black absolute w-[100px] bg-white rounded-md border" style={{
                left: 'calc(50% - 50px)',
                top: '-15px',
                zIndex: 2
              }}
              onClick={() => {
                dispatch(setValue({ focused: false }))
              }}>
                <KeyboardDoubleArrowDownIcon />
              </div> : null
          }
            { paymentElem }
        </div>
      }
      
      
    </div>
  )
}