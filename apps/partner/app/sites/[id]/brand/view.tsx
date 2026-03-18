'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import PaletteIcon from '@mui/icons-material/Palette'
import LanguageIcon from '@mui/icons-material/Language'
import WcIcon from '@mui/icons-material/Wc'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import SurfingIcon from '@mui/icons-material/Surfing'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CircularProgress from '@mui/material/CircularProgress'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import InputAdornment from '@mui/material/InputAdornment'
import { useSite } from '@/app/sites/site-context'
import { getBrand, saveBrand, checkSlug, generateSlug } from '@/app/sites/[id]/site-actions'
import dayjs from 'dayjs'

const serviceIcons: { [key: string]: React.ReactElement } = {
  'wc': <WcIcon sx={{ fontSize: 14 }} />,
  'food': <RestaurantIcon sx={{ fontSize: 14 }} />,
  'drinks': <LocalBarIcon sx={{ fontSize: 14 }} />,
  'rental': <SurfingIcon sx={{ fontSize: 14 }} />,
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'too-short'

export default function BrandView() {

  const { site } = useSite()

  if (site.subscriptionTier !== 'BUSINESS') {
    return (
      <div className="container mx-auto p-4">
        <div className="mt-8 flex flex-col items-center text-center max-w-md mx-auto">
          <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <PaletteIcon sx={{ fontSize: 32, color: '#6366f1' }} />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Branded Booking Page</h2>
          <p className="text-sm text-gray-500 mb-2">
            Create a fully branded booking experience for your customers with your own colors, logo, and custom URL.
          </p>
          <ul className="text-sm text-gray-500 text-left mb-6 space-y-1.5">
            <li className="flex items-start gap-2"><span className="text-indigo-500 mt-0.5">&#x2713;</span> Custom brand name &amp; tagline</li>
            <li className="flex items-start gap-2"><span className="text-indigo-500 mt-0.5">&#x2713;</span> Unique booking URL (sunbnb.app/s/your-beach)</li>
            <li className="flex items-start gap-2"><span className="text-indigo-500 mt-0.5">&#x2713;</span> Custom background &amp; text colors</li>
            <li className="flex items-start gap-2"><span className="text-indigo-500 mt-0.5">&#x2713;</span> Branded reservation pages</li>
          </ul>
          <p className="text-xs text-gray-400 mb-4">
            Available on the <span className="font-semibold text-indigo-500">Business</span> plan
          </p>
          <a
            href="/account/subscription"
            className="inline-flex items-center px-5 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
          >
            Upgrade to Business
          </a>
        </div>
      </div>
    )
  }

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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

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
        // Allow auto-save after initial load settles
        setTimeout(() => { loadedRef.current = true }, 100)
      }
    }
    load()
  }, [site.id])

  const handleSlugChange = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setSlug(normalized)
    debouncedCheckSlug(normalized)
  }

  // Debounced auto-save
  useEffect(() => {
    if (!loadedRef.current) return
    if (slugStatus === 'taken' || slugStatus === 'checking') return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
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
          setMessage({ type: 'success', text: 'Saved' })
        } else {
          setMessage({ type: 'error', text: result.errors?.join(', ') || 'Save failed' })
        }
      } catch {
        setMessage({ type: 'error', text: 'Unexpected error' })
      } finally {
        setSaving(false)
      }
    }, 800)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [brandName, slug, tagline, bgColor, fgColor, slugStatus, site.id])

  const itemCount = (site.inventoryItems || []).length
  const availableCount = (site.inventoryItems || []).filter(item => item.status === 'active' && (item.reservations || []).length === 0).length

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
    <div className="pt-2">
      <div className="mt-4 mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Branded Booking Page</h2>
          <p className="text-sm text-gray-500 mt-1">
            Customize how your beach looks to customers when they book sunbeds.
          </p>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400">
          {saving && <><CircularProgress size={12} /> <span>Saving…</span></>}
          {!saving && message?.type === 'success' && <><CheckCircleIcon sx={{ fontSize: 14, color: '#16a34a' }} /> <span className="text-green-600">{message.text}</span></>}
          {!saving && message?.type === 'error' && <><ErrorIcon sx={{ fontSize: 14, color: '#dc2626' }} /> <span className="text-red-600">{message.text}</span></>}
        </div>
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

        {/* Live preview */}
        <section>
          <h3 className="font-medium text-gray-700 mb-4">Preview</h3>
          <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm mx-auto" style={{ maxWidth: 420 }}>
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
              <div className="flex items-center gap-3">
                <div>
                  <span className="mr-1">&#x26F1;</span>
                  <span className="text-green-400 font-medium">{availableCount}</span>
                  <span className="text-white/50 mx-px">/</span>
                  <span className="text-white/60">{itemCount}</span>
                </div>
                {site.price && (
                  <div className="text-white font-medium">
                    <span>&#8364;</span>
                    <span>{site.price}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1 text-white/80">
                {(site.services || []).map(service => (
                  <div key={service} className="border border-white/30 rounded-md px-1 py-px">
                    <div className="-mt-px">{serviceIcons[service]}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Body */}
            <div className="px-4 py-3" style={{ backgroundColor: bgColor, color: fgColor }}>
              <div className="text-xs leading-relaxed mb-3 opacity-70">
                {site.description || 'Your beach description will appear here.'}
              </div>
              {/* Opening hours (collapsed — today only) */}
              {(site.workingHours || []).length > 0 && (() => {
                const now = dayjs()
                const currentDay = now.day() === 0 ? 7 : now.day()
                const todayHours = (site.workingHours || []).find(wh => wh.day === currentDay)
                const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                return (
                  <div className="mb-4">
                    <div className="flex items-center justify-center mb-1">
                      <div className="flex-1 border-t" style={{ borderColor: `${fgColor}20` }} />
                      <span className="px-2 text-[9px] font-bold opacity-60">OPENING HOURS</span>
                      <div className="flex-1 border-t" style={{ borderColor: `${fgColor}20` }} />
                    </div>
                    {todayHours ? (
                      <div className="flex justify-between text-[10px] font-bold">
                        <div>{weekDays[todayHours.day - 1]}</div>
                        <div>{dayjs(todayHours.openTime).format('HH:mm')} - {dayjs(todayHours.closeTime).format('HH:mm')}</div>
                      </div>
                    ) : (
                      <div className="text-[10px] text-center opacity-50">Closed today</div>
                    )}
                    <div className="flex items-center justify-center">
                      <div className="flex-1 border-t" style={{ borderColor: `${fgColor}20` }} />
                      <ExpandMoreIcon sx={{ fontSize: 14, opacity: 0.5 }} />
                      <div className="flex-1 border-t" style={{ borderColor: `${fgColor}20` }} />
                    </div>
                  </div>
                )
              })()}
              {/* Date range field mockup */}
              <div className="relative">
                <div className="rounded border px-3 py-2.5 flex items-center bg-white" style={{ borderColor: `${fgColor}40` }}>
                  <div className="flex-1 text-center text-xs text-gray-500">{dayjs().format('YYYY-MM-DD')} &ndash; {dayjs().add(1, 'day').format('YYYY-MM-DD')}</div>
                </div>
                <div className="absolute -top-2 left-2 px-1.5 text-[9px] rounded bg-white" style={{ color: `${fgColor}80`, border: `1px solid ${fgColor}30` }}>
                  From - To
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}