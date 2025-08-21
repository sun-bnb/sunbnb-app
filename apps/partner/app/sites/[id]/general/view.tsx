'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import {
  APIProvider,
  ControlPosition,
  Map,
  AdvancedMarker,
} from '@vis.gl/react-google-maps'
import {
  Box,
  Button,
  TextField,
  Divider,
  Select,
  MenuItem,
  Chip,
  FormControl,
  InputLabel,
} from '@mui/material'

import { useSite } from '@/app/sites/site-context'
import { SiteProps, WorkingHours } from '@/types/shared'
import MapHandler from '@/components/maps/map-handler'
import { CustomMapControl } from '@/components/maps/map-control'
import {
  submitForm,
  addWorkingHours,
  deleteWorkingHours,
  deleteSite,
  setSiteStatus
} from '../actions'

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export default function GeneralView() {
  const { site, apiKey } = useSite()
  const router = useRouter()

  // Form state
  const [formState, formAction] = useFormState(
    submitForm,
    { status: '' }
  )

  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null)

  // Location state
  const [mapCoords, setMapCoords] = useState<{ lat: number; lng: number } | null>(
    { lat: +site.locationLat!, lng: +site.locationLng! }
  )

  // Working hours state
  const [newHours, setNewHours] = useState<WorkingHours>(
    { day: '1', openTime: '', closeTime: '' }
  )

  // Derived lat/lng strings
  const locationLat = mapCoords?.lat.toString() ?? site.locationLat
  const locationLng = mapCoords?.lng.toString() ?? site.locationLng

  const formatTime = (date: Date) => {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // Sorted working hours
  const sortedHours = useMemo(
    () => [...(site.workingHours ?? [])].sort((a, b) => a.day - b.day),
    [site.workingHours]
  )

  return (
    <Box component="form" action={formAction} className="p-4">
      {/* Errors */}
      {formState.errors?.map(err => (
        <Box key={err} className="text-red-500 mb-2 text-center">
          {err}
        </Box>
      ))}

      {/* Hidden fields */}
      <input type="hidden" name="id" value={site.id} />
      <input type="hidden" name="locationLat" value={locationLat} />
      <input type="hidden" name="locationLng" value={locationLng} />

      {/* Site info */}
      <Box className="flex gap-2 mb-4">
        <TextField
          fullWidth
          name="name"
          label="Site Name"
          defaultValue={site.name}
        />
        <TextField
          fullWidth
          select
          name="type"
          label="Site Type"
          defaultValue={site.type ?? ""}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          <MenuItem value="paid">Paid</MenuItem>
          <MenuItem value="unpaid">Unpaid</MenuItem>
          {/* add more as needed */}
        </TextField>
        <TextField
          fullWidth
          disabled={site.type === 'unpaid'}
          name="price"
          label="Advertised Price"
          defaultValue={site.price?.toString()}
          type="number"
        />
      </Box>


      {/* Working hours */}
      <Divider>Working Hours</Divider>
      <Box className="flex flex-wrap gap-2 my-2">
        {sortedHours.map(hours => (
          <Chip
            key={hours.id}
            label={
              `${WEEK_DAYS[Number(hours.day) - 1]}: ${formatTime(
                hours.openTime
              )} - ${formatTime(hours.closeTime)}`
            }
            onDelete={() => deleteWorkingHours(hours.id)}
          />
        ))}
      </Box>
      <Box className="flex flex-col md:flex-row gap-2 mb-6">
        <FormControl sx={{ minWidth: 120 }}>
          <InputLabel id="weekday-label">Day</InputLabel>
          <Select
            labelId="weekday-label"
            value={newHours.day}
            label="Day"
            onChange={e =>
              setNewHours({ ...newHours, day: e.target.value as string })
            }
          >
            {WEEK_DAYS.map((day, idx) => (
              <MenuItem key={day} value={(idx + 1).toString()}>
                {day}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Open"
          placeholder="HH:MM"
          value={newHours.openTime}
          onChange={e =>
            setNewHours({ ...newHours, openTime: e.target.value })
          }
        />
        <TextField
          label="Close"
          placeholder="HH:MM"
          value={newHours.closeTime}
          onChange={e =>
            setNewHours({ ...newHours, closeTime: e.target.value })
          }
        />
        <Button
          variant="outlined"
          onClick={() => addWorkingHours(site.id!, newHours)}
        >
          + Add
        </Button>
      </Box>

      {/* Map */}
      <Divider>Site Location</Divider>
      <Box className="h-[500px] my-4 border border-gray-300">
        <APIProvider apiKey={apiKey}>
          <Map
            mapId="site-map"
            defaultZoom={9}
            defaultCenter={{ lat: +site.locationLat!, lng: +site.locationLng! }}
            gestureHandling="greedy"
            disableDefaultUI
            onClick={e => setMapCoords(e.detail.latLng!)}
          >
            {mapCoords && (
              <AdvancedMarker position={mapCoords} />
            )}
          </Map>
          <CustomMapControl
            controlPosition={ControlPosition.TOP_LEFT}
            onPlaceSelect={setSelectedPlace}
          />
          <MapHandler place={selectedPlace} />
        </APIProvider>
      </Box>

      {/* Actions */}
      <Box className="space-y-2 pb-6">
        <Button type="submit" variant="contained" fullWidth>
          Save
        </Button>
        <Button variant="outlined" fullWidth
          onClick={async () => {
            await setSiteStatus(site.id!, site.status === 'active' ? 'hidden' : 'active')
              .then((result) => {{
                if (result.status === 'ok') {
                  site.status = site.status === 'active' ? 'hidden' : 'active'
                }
              }})
          }}>
          { site.status === 'active' ? 'Hide Site' : 'Activate Site' }
        </Button>
        <Button
          variant="outlined"
          color="error"
          fullWidth
          onClick={async () => {
            await deleteSite(site.id!)
            router.push('/sites')
          }}
        >
          Delete Site
        </Button>
      </Box>
    </Box>
  )
}
