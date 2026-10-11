// Pure open/auto-fit zoom for the staff sunbed grid (ManageView pan/zoom canvas).

/** Seat tile width in canvas px at scale 1 (ParcelView seat column). */
export const SEAT_WIDTH_PX = 48
/** Smallest seat width (screen px) we allow on a phone — a tappable target. */
export const MIN_TAP_SEAT_PX = 40
/** Viewports narrower than this are treated as phones (Tailwind `sm`). */
export const PHONE_MAX_WIDTH = 640

export interface OpenZoomInput {
  viewportW: number
  contentW: number
  zoomMax: number
  /** Desktop/tablet: fraction of fit-to-width, leaving side margins. */
  desktopRatio: number
  /** Desktop/tablet floor (very wide parcels open here and pan). */
  desktopMin: number
}

/**
 * Phone: fill the full width when the grid is smaller than the viewport (no
 * margins, no half-empty screen), but never shrink seats below MIN_TAP_SEAT_PX
 * — a wider grid opens at that floor and pans inside its own container.
 * Desktop/tablet: unchanged (fit × ratio, floored).
 */
export function computeOpenZoom(i: OpenZoomInput): number {
  const fitW = i.viewportW / i.contentW
  if (i.viewportW < PHONE_MAX_WIDTH) {
    const tapMin = MIN_TAP_SEAT_PX / SEAT_WIDTH_PX
    return Math.min(i.zoomMax, Math.max(tapMin, fitW))
  }
  return Math.min(i.zoomMax, Math.max(i.desktopMin, fitW * i.desktopRatio))
}
