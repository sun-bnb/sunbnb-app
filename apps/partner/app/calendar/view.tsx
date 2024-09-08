'use client'

import dayjs from 'dayjs'
import React, { useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import { useGetReservationsQuery, useGetMonthReservationsQuery } from '@/store/features/api/apiSlice'
import { setValue } from '@/store/features/reservations/reservationsSlice'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import { InventoryItem, Reservation, SiteProps } from '../../types/shared'
import { RootState } from '@/store/store'
import DayCalendar from './DayCalendar'
import MonthCalendar from './MonthCalendar'

export default function CalendarView({ sites }: { sites: SiteProps[] }) {

  const dispatch = useDispatch()

  const view = useSelector((state: RootState) => state.reservations.view)
  const selectedDate = useSelector((state: RootState) => state.reservations.selectedDate)
  const selectedMonth = useSelector((state: RootState) => state.reservations.selectedMonth)
  const siteId = useSelector((state: RootState) => state.reservations.siteId)

  const now = useMemo(() => new Date().toISOString(), []);
  const nowMonth = useMemo(() => new Date().toISOString().substring(0, 7), []);

  const { data: reservationsResponse } = useGetReservationsQuery({ 
    siteId: siteId || sites[0]?.id || '',
    date: selectedDate || now
  })

  const { data: monthReservationsResponse } = useGetMonthReservationsQuery({ 
    siteId: siteId || sites[0]?.id || '',
    month: selectedMonth || nowMonth
  })


  console.log('Reservations', reservationsResponse, monthReservationsResponse)

  const selectedDay = dayjs(selectedDate || now)
  const weekDay = selectedDay.format('dddd')
  const monthDay = selectedDay.format('MMM D, YYYY')

  return (
    <div className="w-full">
      <div className="-ml-[4px] md:-ml-[8px] flex justify-between">
        <div>
          <FormControl sx={{ m: 1, minWidth: 200 }}>
            <InputLabel>Site</InputLabel>
            <Select
              value={siteId || sites[0]?.id || ''}
              label="Site"
              className="h-[40px]"
              onChange={(e) => {
                dispatch(setValue({ siteId: e.target.value as string }))
              }}
            >
              {
                sites.map(site => (
                  <MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>
                ))
              }
            </Select>
          </FormControl>
        </div>
        <div className="flex items-center -mr-[4px] md:-mr-[6px]" onClick={() =>
          dispatch(setValue({ view: view === 'day' ? 'month' : 'day' }))
        }>
          <div className="text-[14px] mr-1">
              <div className="flex justify-end">
                {weekDay}
              </div>
              <div className="flex justify-end">
                {monthDay}
              </div>
          </div>
          <div>
            <CalendarMonthIcon sx={{ fontSize: '44px', marginTop: '-2px' }} onClick={() => {
              dispatch(setValue({ view: view === 'day' ? 'month' : 'day' }))
            }}/>
          </div>
        </div>
      </div>
      {
        view === 'day' ? (
          <div className="container w-[100vw] overflow-x-auto">
            <DayCalendar reservations={reservationsResponse?.reservations || []} />
          </div>
        ) : (
          <MonthCalendar reservations={monthReservationsResponse?.reservations || []} />
        )
      }
    </div>
  )
}