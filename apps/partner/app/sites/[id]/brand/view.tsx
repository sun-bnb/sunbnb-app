'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import PaletteIcon from '@mui/icons-material/Palette'
import ImageIcon from '@mui/icons-material/Image'
import LanguageIcon from '@mui/icons-material/Language'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CircularProgress from '@mui/material/CircularProgress'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import Alert from '@mui/material/Alert'
import InputAdornment from '@mui/material/InputAdornment'
import { useSite } from '@/app/sites/site-context'
import { getBrand, saveBrand, checkSlug, generateSlug } from '@/app/sites/[id]/site-actions'

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'too-short'

export default function BrandView() {

  const { site } = useSite()

  const [brandName, setBrandName] = useState(site.name || '')
  const [slug, setSlug] = useState('')
  const [tagline, setTagline] = useState('')
  const [bgColor, setBgColor] = useState('#faf9f6')
  const [fgColor, setFgColor] = useState('#111827')

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')

  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced slug availability check
  const debouncedCheckSlug = useCallback((value: string) => {
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)

    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!normalized) {
      setSlugStatus('idle')
      return
    }
    if (normalized.length < 3) {
      setSlugStatus('too-short')
      return
    }

    setSlugStatus('checking')
    slugCheckTimer.current = setTimeout(async () => {
      try {
        const result = await checkSlug(normalized, site.id!)
        setSlugStatus(result.available ? 'available' : 'taken')
      } catch {
        setSlugStatus('idle')
      }
    }, 500)
  }, [site.id])

  // Load persisted brand on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await getBrand(site.id!)
        if (data) {
          if (data.slug) {
            setSlug(data.slug)
            setSlugStatus('available')
          } else {
            // Auto-generate slug from site name
            const generated = await generateSlug(data.name || site.name || '', site.id!)
            if (generated) {
              setSlug(generated)
              setSlugStatus('available')
            }
          }
          if (data.brand) {
            setBrandName(data.brand.brandName || site.name || '')
            setTagline(data.brand.tagline || '')
            setBgColor(data.brand.bgColor || '#faf9f6')
            setFgColor(data.brand.fgColor || '#111827')
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [site.id])

  const handleSlugChange = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setSlug(normalized)
    debouncedCheckSlug(normalized)
  }

  const handleSave = async () => {
    if (slugStatus === 'taken') {
      setMessage({ type: 'error', text: 'Slug is already taken — pick a different one' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const result = await saveBrand({
        siteId: site.id!,
        brandName,
        slug,
        tagline,
        bgColor,
        fgColor,
      })
      if (result.status === 'ok') {
        setMessage({ type: 'success', text: 'Brand settings saved' })
      } else {
        setMessage({ type: 'error', text: result.errors?.join(', ') || 'Save failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Unexpected error' })
    } finally {
      setSaving(false)
    }
  }

  const bookingUrl = slug
    ? `https://sunbnb.app/s/${slug}`
    : `https://sunbnb.app/sites/${site.id}`

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <CircularProgress size={28} />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">Branded Booking Page</h2>
        <p className="text-sm text-gray-500 mt-1">
          Customize how your beach looks to customers when they book sunbeds.
        </p>
      </div>

      {/* Preview link */}
      <div className="flex items-center gap-2 px-4 py-3 bg-sky-50 border border-sky-200 rounded mb-6">
        <LanguageIcon fontSize="small" className="text-sky-600" />
        <code className="text-sm text-sky-800 flex-1 truncate">{bookingUrl}</code>
        <Button
          size="small"
          variant="text"
          endIcon={<OpenInNewIcon fontSize="small" />}
          href={bookingUrl}
          target="_blank"
          sx={{ textTransform: 'none', fontSize: '0.75rem' }}
        >
          Preview
        </Button>
      </div>

      <div className="flex flex-col gap-8">

        {/* Identity */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <PaletteIcon fontSize="small" className="text-gray-500" />
            <h3 className="font-medium text-gray-700">Identity</h3>
          </div>
          <div className="flex flex-col gap-4">
            <TextField
              label="Brand name"
              fullWidth
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              helperText="Shown as the page title to your customers"
              size="small"
            />
            <TextField
              label="URL slug"
              fullWidth
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-beach"
              helperText={
                slugStatus === 'checking' ? 'Checking availability…'
                  : slugStatus === 'available' ? `✓ sunbnb.app/s/${slug} is available`
                  : slugStatus === 'taken' ? 'This slug is already taken'
                  : slugStatus === 'too-short' ? 'Slug must be at least 3 characters'
                  : slug ? `sunbnb.app/s/${slug}` : 'Auto-generated from site name'
              }
              error={slugStatus === 'taken' || slugStatus === 'too-short'}
              color={slugStatus === 'available' ? 'success' : undefined}
              size="small"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    {slugStatus === 'checking' && <CircularProgress size={16} />}
                    {slugStatus === 'available' && <CheckCircleIcon fontSize="small" sx={{ color: '#16a34a' }} />}
                    {slugStatus === 'taken' && <ErrorIcon fontSize="small" color="error" />}
                  </InputAdornment>
                ),
              }}
              FormHelperTextProps={slugStatus === 'available' ? { sx: { color: '#16a34a' } } : undefined}
            />
            <TextField
              label="Tagline"
              fullWidth
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Premium beach experience in Chania"
              helperText="Short description below the brand name"
              size="small"
            />
            <div className="flex gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-mono">{bgColor}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Text color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-mono">{fgColor}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Divider />

        {/* Cover image */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon fontSize="small" className="text-gray-500" />
            <h3 className="font-medium text-gray-700">Cover Image</h3>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Hero image displayed at the top of your booking page.
          </p>
          {site.image && (
            <div className="mb-3 rounded overflow-hidden border border-gray-200" style={{ maxWidth: 400 }}>
              <img src={site.image} alt="Current cover" className="w-full h-auto" />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button variant="outlined" component="label" size="small" sx={{ textTransform: 'none' }}>
              Upload image
              <input type="file" hidden accept="image/*" />
            </Button>
            <span className="text-xs text-gray-400">Recommended: 1200 × 400px</span>
          </div>
        </section>

        <Divider />

        {/* Live preview */}
        <section>
          <h3 className="font-medium text-gray-700 mb-4">Preview</h3>
          <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm" style={{ maxWidth: 420 }}>
            {/* Hero image with gradient + brand name */}
            <div className="relative">
              {site.image ? (
                <img src={site.image} alt="" className="w-full h-[140px] object-cover" />
              ) : (
                <div className="w-full h-[140px] bg-gray-300" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent" style={{ height: '60%' }} />
              <div className="absolute top-3 left-4 right-4">
                <div className="text-white font-bold text-base drop-shadow-lg">{brandName || 'Your Beach'}</div>
                {tagline && <div className="text-white/80 text-xs mt-0.5 drop-shadow-md">{tagline}</div>}
              </div>
            </div>
            {/* Status bar */}
            <div className="flex justify-between items-center px-3 py-1.5 bg-black/30 text-white text-xs">
              <div className="flex items-center gap-2">
                <span>&#x26F1; <span className="text-green-400">4</span><span className="text-white/40">/</span><span className="text-white/50">12</span></span>
                <span>&#8364;25</span>
              </div>
              <div className="flex gap-1 text-white/60 text-[10px]">
                <span className="border border-white/20 rounded px-1">&#x1F374;</span>
                <span className="border border-white/20 rounded px-1">&#x1F3C4;</span>
              </div>
            </div>
            {/* Body */}
            <div className="px-4 py-3" style={{ backgroundColor: bgColor, color: fgColor }}>
              <div className="text-xs leading-relaxed mb-3 opacity-70">
                {site.description || 'Your beach description will appear here.'}
              </div>
              {/* Reservation panel mockup */}
              <div className="rounded-lg border p-3" style={{ borderColor: `${fgColor}15` }}>
                <div className="flex flex-col gap-1.5 mb-2">
                  <div className="h-7 rounded flex items-center px-2 text-[10px]" style={{ backgroundColor: `${fgColor}08`, color: `${fgColor}99` }}>Select dates</div>
                  <div className="h-7 rounded flex items-center px-2 text-[10px]" style={{ backgroundColor: `${fgColor}08`, color: `${fgColor}99` }}>Select sunbed</div>
                </div>
                <div className="h-8 rounded flex items-center justify-center text-xs font-medium text-white bg-blue-600">
                  Reserve
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Save */}
        {message && (
          <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ mb: 1 }}>
            {message.text}
          </Alert>
        )}
        <div className="flex justify-end pb-4">
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            sx={{ textTransform: 'none' }}
          >
            {saving ? <CircularProgress size={20} sx={{ mr: 1, color: 'white' }} /> : null}
            Save Brand Settings
          </Button>
        </div>
      </div>
    </div>
  )
}