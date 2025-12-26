// components/map/SvgVenue.tsx
'use client'
import React from 'react'

interface SvgVenueProps {
  innerSvg?: string          // raw <g>…</g> markup
  imageHref?: string         // fallback to <image>
  pxW: number                // e.g., 800
  pxH: number                // e.g., 600
  worldW: number             // e.g., 80 (meters)
  worldH: number             // e.g., 60
}

export default function SvgVenue({ innerSvg, imageHref, pxW, pxH, worldW, worldH }: SvgVenueProps) {
  const sx = worldW / pxW
  const sy = worldH / pxH
  if (innerSvg) {
    return <g transform={`scale(${sx} ${sy})`} dangerouslySetInnerHTML={{ __html: innerSvg }} />
  }
  return <image href={imageHref} x={0} y={0} width={worldW} height={worldH} preserveAspectRatio="xMidYMid meet" />
}
