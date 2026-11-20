import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

/** The one shared share image (CR-003): logo and wordmark on the landing's sand, 1200×630, built at build time. */
export const alt = 'Sunbnb'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  const svg = await readFile(join(process.cwd(), 'public/sunbnb-logo.svg'), 'utf8')
  const logo = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48, background: '#fff5e1' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> only */}
        <img src={logo} width={263} height={240} alt="" />
        <div style={{ fontSize: 140, fontWeight: 700, color: '#0e3a4a', letterSpacing: -4 }}>Sunbnb</div>
      </div>
    ),
    size,
  )
}
