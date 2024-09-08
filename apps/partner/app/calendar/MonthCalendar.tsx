'use client'

import dayjs, { Dayjs } from 'dayjs'
import Badge from '@mui/material/Badge'
import { useDispatch, useSelector } from 'react-redux'
import { setValue } from '@/store/features/reservations/reservationsSlice'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { PickersDay, PickersDayProps } from '@mui/x-date-pickers/PickersDay';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { DayCalendarSkeleton } from '@mui/x-date-pickers/DayCalendarSkeleton';
import { Reservation } from '../../types/shared';
import { useState } from 'react';
import { RootState } from '@/store/store'


function ServerDay(props: PickersDayProps<Dayjs> & { highlightedDays?: { day: number, count: number }[] }) {
  const { highlightedDays = [], day, outsideCurrentMonth, ...other } = props;

  const isSelected =
    !props.outsideCurrentMonth && highlightedDays.map(d => d.day).indexOf(props.day.date()) >= 0;

  const selectedHl = highlightedDays.find(d => d.day === props.day.date())

  return (
    <Badge
      key={props.day.toString()}
      overlap="circular"
      badgeContent={isSelected ?
        <div className="bg-blue-600 w-[16px] h-[16px] mt-[6px] mr-[6px] rounded-full">
          <div className="text-white text-xs text-center">
            {selectedHl && selectedHl.count}
          </div>
        </div>
        : undefined}
    >
      <PickersDay {...other} outsideCurrentMonth={outsideCurrentMonth} day={day} />
    </Badge>
  );
}

export default function MonthCalendar({ reservations }: { reservations: { date: string, count: number }[] }) {

  const dispatch = useDispatch()

  const selectedDate = useSelector((state: RootState) => state.reservations.selectedDate)

  //const [ highlightedDays, setHighlightedDays ] = useState([1, 2, 15]);

  const highlightedDays = reservations.map(reservation => ({ count: reservation.count, day: dayjs(reservation.date).date() }))
  console.log('highlightedDays', highlightedDays)

  return (
    <div>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DateCalendar
          value={selectedDate && dayjs(selectedDate)}
          onMonthChange={(date) => {
            const month = `${date.year()}-${String(date.month() + 1).padStart(2, '0')}`
            console.log('month changed', month)
            dispatch(setValue({
              selectedMonth: month,
              selectedDate: null
            }))
          }}
          onChange={(date) => {
            console.log('date changed', date)
            dispatch(setValue({
              selectedDate: date.toISOString(),
              view: 'day'
            }))
          }}
          renderLoading={() => <DayCalendarSkeleton />}
          slots={{
            day: ServerDay,
          }}
          slotProps={{
            day: {
              highlightedDays,
            } as any,
          }}
        />
      </LocalizationProvider>
    </div>
  )

}