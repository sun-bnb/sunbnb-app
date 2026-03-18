'use client'

import { saveContentFields, uploadContentImage } from '../content-actions'

import React, { useRef, useState, useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import SyncIcon from '@mui/icons-material/Sync'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useSite } from '@/app/sites/site-context'

const ALL_SERVICES = [
  { value: 'wc', label: 'WC', description: 'Restroom facilities', icon: <WcIcon /> },
  { value: 'food', label: 'Food', description: 'Food service available', icon: <RestaurantIcon /> },
  { value: 'drinks', label: 'Drinks', description: 'Bar or refreshments', icon: <LocalBarIcon /> },
  { value: 'rental', label: 'Rental', description: 'Equipment rental', icon: <SurfingIcon /> },
]

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function Content() {

  const { site } = useSite()
  const fileRef = useRef<HTMLInputElement>(null)

  const [description, setDescription] = useState(site.description || '')
  const [services, setServices] = useState<string[]>(
    (site.services || []).filter(s => ALL_SERVICES.map(sv => sv.value).includes(s))
  )
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)

  const doSave = useCallback(async (overrides?: {
    description?: string
    services?: string[]
  }) => {
    setSaveStatus('saving')
    try {
      const result = await saveContentFields({
        id: site.id!,
        description: overrides?.description ?? description,
        services: overrides?.services ?? services,
      })
      if (result.status === 'ok') {
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }, [site.id, description, services])

  const scheduleSave = useCallback((overrides?: Parameters<typeof doSave>[0]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSave(overrides), 2000)
  }, [doSave])

  const immediateSave = useCallback((overrides?: Parameters<typeof doSave>[0]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSave(overrides)
  }, [doSave])

  const handleImageUpload = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    setSaveStatus('saving')
    try {
      const fd = new FormData()
      fd.append('image', file)
      const result = await uploadContentImage(site.id!, fd)
      if (result.status === 'ok') {
        setSaveStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setUploading(false)
    }
  }, [site.id])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleImageUpload(file)
    }
  }, [handleImageUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImageUpload(file)
  }, [handleImageUpload])

  const toggleService = useCallback((value: string) => {
    setServices(prev => {
      const next = prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
      immediateSave({ services: next })
      return next
    })
  }, [immediateSave])

  const displayImage = preview || site.image

  return (
    <div className="pt-2">

      {/* Save status indicator */}
      <div className={`flex items-center justify-center gap-2 px-3 py-2 rounded mb-4 text-sm transition-all ${
        saveStatus === 'saving' ? 'bg-blue-50 border border-blue-200 text-blue-600' :
        saveStatus === 'saved' ? 'bg-green-50 border border-green-200 text-green-600' :
        saveStatus === 'error' ? 'bg-red-50 border border-red-200 text-red-600' :
        'bg-gray-50 border border-gray-200 text-gray-400'
      }`}>
        {saveStatus === 'saving' && <><SyncIcon fontSize="small" className="animate-spin" /> {uploading ? 'Uploading image…' : 'Saving…'}</>}
        {saveStatus === 'saved' && <><CloudDoneIcon fontSize="small" /> All changes saved</>}
        {saveStatus === 'error' && <><WarningAmberIcon fontSize="small" /> Error saving changes</>}
        {saveStatus === 'idle' && <><CloudDoneIcon fontSize="small" /> Up to date</>}
      </div>

      {/* Cover photo */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Cover photo</h3>

        {displayImage ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative rounded-lg overflow-hidden mb-2 transition-all border-2 ${
              dragging
                ? 'border-blue-400 ring-2 ring-blue-200'
                : 'border-gray-200'
            }`}
          >
            <img
              src={displayImage}
              alt="Cover"
              className={`w-full h-48 object-cover transition-opacity ${uploading || dragging ? 'opacity-50' : ''}`}
            />
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <CircularProgress size={32} sx={{ color: 'white' }} />
              </div>
            )}
            {dragging && !uploading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-blue-500/20">
                <CloudUploadIcon sx={{ fontSize: 36 }} className="text-blue-500" />
                <p className="text-sm font-medium text-blue-600 mt-1">Drop to replace</p>
              </div>
            )}
            <div className={`absolute inset-0 bg-black/0 hover:bg-black/30 transition-all flex items-center justify-center opacity-0 hover:opacity-100 ${uploading || dragging ? 'pointer-events-none' : ''}`}>
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
                  onChange={handleFileChange}
                />
              </Button>
            </div>
          </div>
        ) : (
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
              onChange={handleFileChange}
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
          value={description}
          onChange={e => {
            setDescription(e.target.value)
            scheduleSave({ description: e.target.value })
          }}
          placeholder="Tell your customers what makes this beach special…"
          helperText="Shown on the booking page. A few sentences work best."
        />
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Services */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-1">On-site services</h3>
        <p className="text-xs text-gray-500 mb-3">
          Select what's available at your beach. These are shown as icons on the booking page.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_SERVICES.map(service => {
            const selected = services.includes(service.value)
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