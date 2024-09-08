'use client'

import Link from 'next/link'
import { createInventoryItem } from './actions'

import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import ImageUploading, { ImageListType } from 'react-images-uploading'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'

import { saveContent } from './actions'

const allServices = [
  { value: 'wc', label: 'WC', icon: <WcIcon /> },
  { value: 'food', label: 'Food', icon: <RestaurantIcon /> },
  { value: 'drinks', label: 'Drinks', icon: <LocalBarIcon /> },
  { value: 'rental', label: 'Rental', icon: <SurfingIcon /> }
]

export default function Content({ siteId, content } : { siteId: string, content: any }) {
  
  const [ formState, formAction ] = useFormState(saveContent, { status: '' })

  const [ images, setImages ] = React.useState([])
  const [ services, setServices ] = React.useState<string[]>((content.services || []).filter((s: string) => allServices.map(s => s.value).includes(s)))

  console.log('Content', content)

  const maxNumber = 69

  const onImageChange = (
    imageList: ImageListType,
    addUpdateIndex: number[] | undefined
  ) => {
    // data for submit
    console.log(imageList, addUpdateIndex);
    setImages(imageList as never[]);
  };



  console.log('services', services, content.services)
  return (
    <div className="container mx-auto">
      <div className="mt-6 flex w-full">
        <form action={formAction} className="w-full">
          <input type="hidden" name="id" value={siteId} />
          <input type="hidden" name="services" value={services.join(',')} />
          <div className="px-2 md:p-0 md:flex w-full">
            <div className="mt-4 md:max-w-[250px]">
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900">Site image</label>
              </div>
              {
                content.image &&
                  <div className="w-full flex justify-center md:justify-start">
                    <img width="250px" src={content.image} />
                  </div>
              }
              <div className="mt-2 mb-2 w-full">
                <input type="file" id="image" name="image" />
              </div>
            </div>
            <div className="px-2 md:pl-4 flex-1">
              <div>
                <div className="text-sm mb-2">Available services</div>
                <div>
                  {
                    allServices.map((service, index) => {

                      const variant = services.includes(service.value) ? 'filled' : 'outlined'
                      const color = services.includes(service.value) ? 'primary' : 'default'

                      return (
                        <Chip onClick={() => {
                          if (services.includes(service.value)) {
                            setServices(services.filter(s => s !== service.value))
                          } else {
                            setServices([...services, service.value])
                          }
                        }} variant={variant} color={color} key={`service-${index}`} sx={{ marginRight: '6px', marginBottom: '6px' }} label={
                          <div className="flex items-center">
                            <div className="mr-2">
                              { service.icon }
                            </div>
                            <div>
                              { service.label }
                            </div>
                          </div>
                        } />
                      )
                    })
                  }
                </div>
              </div>
              <div className="mt-4 flex-1">
                <TextField
                  name="description"
                  label="Site description"
                  fullWidth={true}
                  multiline
                  defaultValue={content.description || ''}
                  variant="standard"
                />
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="submit" variant="contained">Save</Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )

}