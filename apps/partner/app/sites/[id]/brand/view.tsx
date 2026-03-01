'use client'

import React, { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Divider from '@mui/material/Divider'
import PaletteIcon from '@mui/icons-material/Palette'
import ImageIcon from '@mui/icons-material/Image'
import LanguageIcon from '@mui/icons-material/Language'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useSite } from '@/app/sites/site-context'

export default function BrandView() {

  const { site } = useSite()

  const [brandName, setBrandName] = useState(site.name || '')
  const [slug, setSlug] = useState('')
  const [tagline, setTagline] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#0ea5e9')
  const [accentColor, setAccentColor] = useState('#f59e0b')
  const [showMap, setShowMap] = useState(true)
  const [showPrices, setShowPrices] = useState(true)
  const [customDomain, setCustomDomain] = useState('')

  const bookingUrl = slug
    ? `https://sunbnb.app/b/${slug}`
    : `https://sunbnb.app/sites/${site.id}`

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
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-beach"
              helperText={slug ? `sunbnb.app/b/${slug}` : 'Leave empty to use the default site URL'}
              size="small"
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
                <label className="text-xs text-gray-500">Primary color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-mono">{primaryColor}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Accent color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-mono">{accentColor}</span>
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

        {/* Booking page options */}
        <section>
          <h3 className="font-medium text-gray-700 mb-3">Booking Page Options</h3>
          <div className="flex flex-col gap-2">
            <FormControlLabel
              control={<Switch checked={showMap} onChange={(e) => setShowMap(e.target.checked)} />}
              label={<span className="text-sm">Show interactive map on booking page</span>}
            />
            <FormControlLabel
              control={<Switch checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} />}
              label={<span className="text-sm">Show prices before checkout</span>}
            />
          </div>
        </section>

        <Divider />

        {/* Custom domain */}
        <section>
          <h3 className="font-medium text-gray-700 mb-3">Custom Domain</h3>
          <p className="text-sm text-gray-500 mb-3">
            Point your own domain to this booking page (e.g. <code className="text-xs bg-gray-100 px-1 rounded">book.mybeach.com</code>).
          </p>
          <TextField
            label="Custom domain"
            fullWidth
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="book.mybeach.com"
            size="small"
          />
        </section>

        <Divider />

        {/* Live preview mockup */}
        <section>
          <h3 className="font-medium text-gray-700 mb-4">Preview</h3>
          <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            {/* Header bar */}
            <div
              className="px-6 py-4"
              style={{ backgroundColor: primaryColor }}
            >
              <h4 className="text-white font-bold text-lg">{brandName || 'Your Beach'}</h4>
              {tagline && <p className="text-white/80 text-sm mt-0.5">{tagline}</p>}
            </div>
            {/* Body */}
            <div className="px-6 py-5 bg-white">
              {site.image && (
                <div className="rounded overflow-hidden mb-4" style={{ maxHeight: 160 }}>
                  <img src={site.image} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex gap-3 mb-4">
                {showMap && (
                  <div className="flex-1 h-24 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">
                    Map
                  </div>
                )}
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-8 bg-gray-100 rounded flex items-center px-3 text-xs text-gray-400">
                    Select date
                  </div>
                  <div className="h-8 bg-gray-100 rounded flex items-center px-3 text-xs text-gray-400">
                    Select sunbed
                  </div>
                  {showPrices && (
                    <div className="h-8 bg-gray-100 rounded flex items-center px-3 text-xs text-gray-400">
                      Price: —
                    </div>
                  )}
                </div>
              </div>
              <div
                className="w-full py-2 rounded text-center text-white text-sm font-medium"
                style={{ backgroundColor: accentColor }}
              >
                Reserve Now
              </div>
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end pb-4">
          <Button variant="contained" sx={{ textTransform: 'none' }}>
            Save Brand Settings
          </Button>
        </div>
      </div>
    </div>
  )
}