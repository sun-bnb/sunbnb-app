'use client'

import Link from 'next/link'
import { createInventoryItem } from './actions'

import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import ImageUploading, { ImageListType } from 'react-images-uploading'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

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
      <div className="mt-6 flex w-full">
        <form action={formAction} className="w-full">
          <input type="hidden" name="id" value={siteId} />
          <div className="md:flex w-full">
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
            </div>
            <div className="pl-4 flex-1">
              <div className="mt-4 flex-1">
                <TextField
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
          <div className="mt-2">
            <input type="file" id="image" name="image" />
          </div>
        </form>
      </div>
    </div>
  )

}