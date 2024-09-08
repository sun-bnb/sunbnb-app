'use client'

import dayjs from 'dayjs'
import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setValue } from '@/store/features/reservations/reservationsSlice'
import { InventoryItem, Reservation } from '../../types/shared'
import { RootState } from '@/store/store'
import { useRouter } from 'next/navigation'

export default function DayCalendar({ reservations }: { reservations: Reservation[] }) {

  const dispatch = useDispatch()
  const router = useRouter()

  const hours = Array.from({ length: 24 }, (_, index) => index);

  const items = reservations.reduce<InventoryItem[]>((acc, reservation) => {
    if (!reservation.item) return acc;
    const exists = acc.some(item => item.id === reservation.item?.id);
    if (!exists) {
      acc.push(reservation.item);
    }
    return acc;
  }, []);
  
  // Utility function to get reservations for an item at a specific hour
  const getReservationsForItemAndHour = (itemId: string, hour: number) => {
    return reservations.filter(
      (res) => {
        const idMatch = res.itemId === itemId
        const dayMatch = res.type === 'days' || dayjs(res.from).hour() <= hour && dayjs(res.to).hour() > hour
        return idMatch && dayMatch
      }
    );
  };

  // Define grid-template-columns dynamically based on the number of items
  const gridTemplateColumns = `50px repeat(${items.length || 1}, 1fr)`

  const nowHour = dayjs(new Date()).hour()

  return (
    <div className="content">
      <div
        className="grid"
        style={{ gridTemplateColumns }}
      > 
        <div className="h-8 border-b border-gray-300 sticky left-0">
        </div>
        {
          items.length > 0 ?
            items.map((item, i) => (
              <div
                key={item.id + '-' + i}
                className="h-8 flex items-center justify-center border-b border-gray-300 relative"
              >
                <div className="font-bold border border-gray-600 rounded-md px-1 absolute -bottom-[6px] bg-white">{String(item.number).padStart(4, '0')}</div>
              </div>
            )) : (
              <div
                className="h-8 flex items-center justify-center border-b border-gray-300 "
              >
                <span className="font-bold"></span>
              </div>
            )
        }

        {
          hours.map((hour) => (
            <React.Fragment key={hour}>
              <div className="h-8 flex items-center justify-end pr-2 border-b border-gray-300 sticky left-0 bg-white">
                <span className="text-sm text-gray-600">{hour}:00</span>
              </div>

              {
                
                items.length > 0 ?
                  items.map((item, i) => {
                    const reservationsForHour = getReservationsForItemAndHour(item.id, hour)

                    const bottomBorder = hour === nowHour ? 'border-b-2 border-black' : 'border-b border-gray-300'
                    return (
                      <div
                        key={`${item.id}-${hour}-${i}`}
                        className={`h-8 ${bottomBorder} flex items-center justify-center`}
                      >
                        {reservationsForHour.map((reservation, index) => (
                          <div onClick={() => router.push(`/reservations/${reservation.id}`)}
                            className="h-[33px] bg-blue-200 text-xs px-2 py-0 w-[60px] flex justify-center -mt-[1px] cursor-pointer"
                            key={`${reservation.id}`}
                          >
                            { 
                              reservation.type === 'hours' ?
                                dayjs(reservation.from).hour() === hour
                                  && (
                                    <div className="relative flex items-center w-full justify-center">
                                      <div className="absolute -top-[10px] w-full border border-black flex justify-center bg-white rounded-md">
                                        {String(reservation.item?.number).padStart(4, '0')}
                                      </div>
                                      <div>
                                        {dayjs(reservation.to).hour() - dayjs(reservation.from).hour()} h
                                      </div>
                                    </div>
                                  ) : (
                                    hour === 12 &&
                                    <div className="relative flex items-center w-full justify-center">
                                      <div className="absolute -top-[10px] w-full border border-black flex justify-center bg-white rounded-md">
                                        {String(reservation.item?.number).padStart(4, '0')}
                                      </div>
                                      <div>
                                        DAY
                                      </div>
                                    </div>
                                  )
                            }
                          </div>
                        ))}
                      </div>
                    );
                  }) : (
                    <div className="h-8 border-b border-gray-300 flex items-center justify-center">
                    </div>
                  )
                }
            </React.Fragment>
        ))}
      </div>
    </div>
  )

}