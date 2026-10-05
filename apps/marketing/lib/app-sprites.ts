'use client'

/**
 * Draws sunbeds EXACTLY as the guest app does (track 027 D8: graphics are the app's, not made up).
 * Mirrors `apps/user/components/reservation/SunbedSelection.tsx` `SiteSunbedMarker`, layer for layer:
 *   status box (the app's CSS colours, 1 px black border) → perforated sunbed image (the colour
 *   shows through the slats) → towel at 30° on selected/booked beds; a sunshade over each pair.
 * Sprites come from `public/app/` (built from the app's own PNGs by scripts/build-sprites.mjs).
 * Used by both the hero beach scene and the map overlay, so the two look identical.
 */

export interface AppSprites {
  bed: HTMLImageElement
  shade: HTMLImageElement
  towel: HTMLImageElement
}

export type BedStatus = 'free' | 'selected' | 'booked'

/** The guest app's literal status colours (SunbedSelection.tsx): free green, selected blue, booked red. */
export const STATUS_FILL: Record<BedStatus, string> = { free: 'green', selected: 'blue', booked: 'red' }

/** The app draws a bed as a box of length L and width L / 2.1 (bed 0.84 × 2.1 m → 1 : 2.5, image 1 : 2.02). */
export const BED_WIDTH_RATIO = 1 / 2.1

let spritesPromise: Promise<AppSprites> | null = null

export function loadAppSprites(): Promise<AppSprites> {
  if (!spritesPromise) {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`sprite failed: ${src}`))
        img.src = src
      })
    spritesPromise = Promise.all([load('/app/sunbed.webp'), load('/app/sunshade.webp'), load('/app/towel.webp')]).then(
      ([bed, shade, towel]) => ({ bed, shade, towel }),
    )
    spritesPromise.catch(() => {
      spritesPromise = null // allow a retry
    })
  }
  return spritesPromise
}

/**
 * One sunbed centred at (x, y). `seaAngle` is the canvas rotation that points "up" at the sea;
 * the backrest goes on the LAND side so the lounger faces the water. `pop` (0–1) scales the bed in
 * for the drop-in animation.
 */
export function drawAppBed(
  ctx: CanvasRenderingContext2D,
  sprites: AppSprites,
  x: number,
  y: number,
  seaAngle: number,
  lengthPx: number,
  status: BedStatus,
  pop = 1,
) {
  const l = lengthPx * pop
  const w = l * BED_WIDTH_RATIO
  ctx.save()
  ctx.translate(x, y)
  // The image's backrest is at its top; turn it to face the sea (backrest away from the water).
  ctx.rotate(seaAngle + Math.PI)
  ctx.globalAlpha = Math.min(1, pop * 1.2)
  ctx.fillStyle = STATUS_FILL[status]
  ctx.fillRect(-w / 2, -l / 2, w, l)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'black'
  ctx.strokeRect(-w / 2, -l / 2, w, l)
  ctx.drawImage(sprites.bed, -w / 2, -l / 2, w, l)
  if (status !== 'free') {
    const t = w * 1.05
    ctx.translate(0, l * 0.12)
    ctx.rotate(Math.PI / 6) // the app's towel sits at 30°
    ctx.drawImage(sprites.towel, -t / 2, -t / 2, t, t)
  }
  ctx.restore()
}

/** The app's sunshade: a 0.6 × bed-length disc of shade with the umbrella image on it. */
export function drawAppShade(ctx: CanvasRenderingContext2D, sprites: AppSprites, x: number, y: number, bedLengthPx: number, pop = 1) {
  const d = bedLengthPx * 0.6 * 1.35 * pop
  ctx.save()
  ctx.globalAlpha = Math.min(1, pop * 1.2)
  ctx.beginPath()
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.arc(x + d * 0.06, y + d * 0.08, d / 2, 0, Math.PI * 2) // its shadow falls slightly offset
  ctx.fill()
  ctx.drawImage(sprites.shade, x - d / 2, y - (d * 213) / 192 / 2, d, (d * 213) / 192)
  ctx.restore()
}

/** Light haptic tick on supporting phones — the "game feel" of every confirmed touch. */
export function haptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(ms)
  } catch {
    /* unsupported */
  }
}
