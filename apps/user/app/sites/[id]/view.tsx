'use client'

import { SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import dayjs, { Dayjs } from 'dayjs'
import { DemoContainer } from '@mui/x-date-pickers/internals/demo'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DateRange } from '@mui/x-date-pickers-pro/models'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SingleInputTimeRangeField } from '@mui/x-date-pickers-pro/SingleInputTimeRangeField'
import { saveReservation } from './actions'

export default function SiteView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const { data: session } = useSession()

  const [ mode, setMode ] = useState('view')

  const [timeRange, setTimeRange] = useState<DateRange<Dayjs>>(() => [
    dayjs('2022-04-17T15:30'),
    dayjs('2022-04-17T18:30'),
  ])

  return (
    <div className="container mx-auto px-4 py-6">
      <div>
        <div>
          {
            site.image &&
              <img className="h-[100px]" src={site.image} />
          }
        </div>
        <div>
          { site.name }
        </div>
        <div className="mt-4 mb-4">
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <SingleInputTimeRangeField
              label="Booking period"
              ampm={false}
              value={timeRange}
              onChange={(newValue) => setTimeRange(newValue)}
            />
          </LocalizationProvider>
        </div>
        <div>
          <Button variant="contained" onClick={
            () => {
              console.log('Reserve', timeRange)
              if (timeRange[0] && timeRange[1]) {
                const from = timeRange[0].toISOString()
                const to = timeRange[1].toISOString()
                saveReservation({
                  from: timeRange[0].toDate(),
                  to: timeRange[1].toDate(),
                  siteId: site.id!,
                  userId: session?.user?.id!
                })
              }
            }
          }>Reserve</Button>
        </div>
      </div>
    </div>
  )

}