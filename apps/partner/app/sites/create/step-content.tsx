'use client'

import React, { useRef, useState, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { WizardData } from './create-site-wizard'

const ALL_SERVICES = [
  { value: 'wc', label: 'WC', description: 'Restroom facilities', icon: <WcIcon /> },
  { value: 'food', label: 'Food', description: 'Food service available', icon: <RestaurantIcon /> },
  { value: 'drinks', label: 'Drinks', description: 'Bar or refreshments', icon: <LocalBarIcon /> },
  { value: 'rental', label: 'Rental', description: 'Equipment rental', icon: <SurfingIcon /> },
]

export default function StepContent({
  data,
  update,
}: {
  data: WizardData
  update: (p: Partial<WizardData>) => void
}) {

  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const setImage = useCallback((file: File | null) => {
    update({ imageFile: file })
    if (file) {
      const url = URL.createObjectURL(file)
      setPreview(url)
    } else {
      setPreview(null)
    }
  }, [update])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setImage(file)
    }
  }, [setImage])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const toggleService = (value: string) => {
    const next = data.services.includes(value)
      ? data.services.filter(s => s !== value)
      : [...data.services, value]
    update({ services: next })
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Content & services</h2>
      <p className="text-sm text-gray-500 mb-5">
        Make your site stand out. Everything here is optional and can be updated later.
      </p>

      {/* Cover photo */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Cover photo</h3>

        {data.imageFile && preview ? (
          /* Preview state */
          <div className="relative rounded-lg border border-gray-200 overflow-hidden mb-2">
            <img
              src={preview}
              alt="Preview"
              className="w-full h-48 object-cover"
            />
            <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-all flex items-center justify-center opacity-0 hover:opacity-100">
              <div className="flex gap-2">
                <Button
                  variant="contained"
                  size="small"
                  component="label"
                  sx={{ textTransform: 'none', bgcolor: 'white', color: 'gray', '&:hover': { bgcolor: 'gray.100' } }}
                >
                  Replace
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={e => {
                      const file = e.target.files?.[0] || null
                      setImage(file)
                    }}
                  />
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => {
                    setImage(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                  sx={{ textTransform: 'none', bgcolor: 'white', color: 'error.main', '&:hover': { bgcolor: 'error.50' } }}
                >
                  Remove
                </Button>
              </div>
            </div>
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500 truncate">{data.imageFile.name}</span>
              <span className="text-xs text-gray-400">
                {(data.imageFile.size / 1024).toFixed(0)} KB
              </span>
            </div>
          </div>
        ) : (
          /* Drop zone */
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileRef.current?.click()}
            className={`relative rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
              dragging
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
            }`}
          >
            <CloudUploadIcon
              sx={{ fontSize: 40 }}
              className={dragging ? 'text-blue-400' : 'text-gray-300'}
            />
            <p className={`text-sm mt-2 ${dragging ? 'text-blue-600' : 'text-gray-500'}`}>
              {dragging ? 'Drop image here' : 'Drag & drop an image, or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Recommended size: 1200 × 400px · JPG or PNG
            </p>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0] || null
                setImage(file)
              }}
            />
          </div>
        )}
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Description */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
        <TextField
          fullWidth
          multiline
          minRows={3}
          value={data.description}
          onChange={e => update({ description: e.target.value })}
          placeholder="Tell your customers what makes this beach special…"
          helperText="Shown on the booking page. A few sentences work best."
        />
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Services */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-1">On-site services</h3>
        <p className="text-xs text-gray-500 mb-3">
          Select what's available at your beach. These are shown as icons on the booking page.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_SERVICES.map(service => {
            const selected = data.services.includes(service.value)
            return (
              <button
                key={service.value}
                type="button"
                onClick={() => toggleService(service.value)}
                className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  selected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`flex-shrink-0 ${selected ? 'text-blue-600' : 'text-gray-400'}`}>
                  {service.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-700'}`}>
                    {service.label}
                  </div>
                  <div className="text-xs text-gray-500">{service.description}</div>
                </div>
                {selected && (
                  <CheckCircleOutlineIcon fontSize="small" className="text-blue-500 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
