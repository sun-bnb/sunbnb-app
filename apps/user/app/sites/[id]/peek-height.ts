/**
 * How much of the mobile reservation drawer stays visible when it is minimized
 * (track 023 P2, extracted from `SiteView` unchanged).
 *
 * The number is a sum of the control heights that must remain reachable without
 * opening the drawer, and it varies by tab because the tabs carry different
 * controls. Getting it wrong is not subtle on a phone: too small clips the date
 * field the guest is meant to tap, too large leaves a slab of empty panel over
 * the page.
 *
 * It lives in its own pure module because it is arithmetic with four branches
 * and no DOM — the part of the drawer worth testing directly.
 */

export interface PeekInput {
  /** The tab currently shown: sunbeds or equipment. */
  viewMode: 'sunbeds' | 'equipment'
  /** Hourly vs daily booking — only the equipment tab offers the choice. */
  reservationMode: 'days' | 'hours'
  /** Does this site rent equipment priced BY THE HOUR (adds the hours/days toggle)? */
  hasHourlyEquipment: boolean
  /** Are both tabs shown? The tab strip itself takes vertical space. */
  hasViewModeTabs: boolean
}

/** Height of the tab strip, when both tabs are present. */
const VIEW_MODE_TABS = 52

/**
 * Sunbeds: date range picker (56) + padding (16) = 72 — but the value shipped is
 * 66, deliberately clipping the field slightly so it reads as continuing below
 * the fold. Kept exactly as it was; changing it is a design decision, not a fix.
 */
const SUNBEDS = 66

/** Equipment, hourly: hours/days toggle (36) + date+time picker (48) + padding (16). */
const EQUIPMENT_HOURLY = 100

/** Equipment, daily: toggle (36) + date range (56) + padding (16). */
const EQUIPMENT_DAILY = 108

export function peekHeight({
  viewMode,
  reservationMode,
  hasHourlyEquipment,
  hasViewModeTabs,
}: PeekInput): number {
  const base =
    viewMode === 'equipment' && hasHourlyEquipment
      ? reservationMode === 'hours'
        ? EQUIPMENT_HOURLY
        : EQUIPMENT_DAILY
      : SUNBEDS

  return base + (hasViewModeTabs ? VIEW_MODE_TABS : 0)
}
