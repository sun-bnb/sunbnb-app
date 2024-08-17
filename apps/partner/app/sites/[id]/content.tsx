'use client'

import Link from 'next/link'
import { createInventoryItem } from './actions'

import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import ImageUploading, { ImageListType } from 'react-images-uploading'

import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'

import { TextField } from '@repo/ui/TextField'
import { SiteProps } from '@/app/sites/types'

import ControlPanel from '@/components/maps/control-panel'
import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'

import { saveContent } from './actions'

export default function Content({ siteId, content } : { siteId: string, content: any }) {
  
  const [formState, formAction] = useFormState(saveContent, { status: '' })


  const [images, setImages] = React.useState([]);
  const maxNumber = 69;
  
  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none disabled:bg-blue-100 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center">
        Save
    </button>
  }


  const onImageChange = (
    imageList: ImageListType,
    addUpdateIndex: number[] | undefined
  ) => {
    // data for submit
    console.log(imageList, addUpdateIndex);
    setImages(imageList as never[]);
  };


  return (
    <div className="container mx-auto">
      <div className="mt-6 flex">
        <form action={formAction}>
          <input type="hidden" name="id" value={siteId} />
          <div>  
            <div className="mt-4">
              <TextField name="description" label="Site description" value={content.description || ''} />
            </div>
          </div>
          <div className="mt-4">
            <div>
            <label className="block mb-2 text-sm font-medium text-gray-900">Site image</label>
            </div>
            {
              content.image &&
                <div>
                  <img width="200px" src={content.image} />
                </div>
            }
            <div className="mt-2">
              <input type="file" id="image" name="image" />
            </div>
          </div>
          <div className="mt-4">
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  )

}