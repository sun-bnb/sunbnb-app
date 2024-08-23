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
    <div className="container mx-auto">
      <div>
        <div className="relative">
          <div className="w-full border-t-2 border-t-white">
            {
              site.image &&
                <img className="w-full h-auto" src={site.image} />
            }
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-white to-transparent via-transparent h-100"></div>
          <div className="absolute top-[2px] left-[12px] text-2xl bg-black bg-opacity-30 px-2 py-1 rounded-lg text-white">
            { site.name }
          </div>
        </div>
        <div className="mt-4 mb-4 px-2">
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <SingleInputTimeRangeField
              label="Reserve chair: From - To"
              ampm={false}
              fullWidth={true}
              value={timeRange}
              onChange={(newValue) => setTimeRange(newValue)}
            />
          </LocalizationProvider>
        </div>
        <div className="px-2">
          <Button variant="contained" 
            fullWidth={true}
            onClick={
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
            }>
              Reserve
            </Button>
        </div>
      </div>
    </div>
  )

}