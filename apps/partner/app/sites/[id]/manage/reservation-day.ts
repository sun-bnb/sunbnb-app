/**
 * Per-day operational state helpers for the manage page.
 *
 * SERVER-ONLY — imports Prisma. Do not import from client components.
 *
 * These helpers implement the expand/parallel-write strategy for P1:
 * each state transition mutates TODAY's ReservationDay row AND mirrors the
 * same values onto the legacy Reservation.operationalStatus/checkedInAt/
 * departedAt fields so nothing downstream breaks before P4 (contract).
 *
 * "Today" is always resolved server-side from the site's venue-local timezone
 * (via @repo/data/site-day) so action signatures are unchanged.
 */

import prisma from '@repo/data/PrismaCient'
import { siteDayKey } from '@repo/data/site-day'
import {
  OP_EXPECTED,
  OP_WALKED_IN,
  OP_COMP,
} from '@repo/data/reservation-status'

// ── Shape ─────────────────────────────────────────────────────────────────────

/**
 * Minimal site shape accepted by the site-day helpers.
 * `locationLat`/`locationLng` are String columns on Site; parse to float here.
 */
export interface SiteForDay {
  timeZone?: string | null
  // Raw String columns from Prisma; parsed to float in toSiteTimezone.
  locationLat?: string | null
  locationLng?: string | null
}

/** Returned shape from resolveTodayRow / applyDayTransition. */
export interface ReservationDayRow {
  id: string
  reservationId: string
  date: Date
  operationalStatus: string
  checkedInAt: Date | null
  departedAt: Date | null
}

// ── Internal: build the SiteTimezone arg from the site row ────────────────────

function toSiteTimezone(site: SiteForDay) {
  return {
    timeZone: site.timeZone ?? null,
    latitude: site.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

// ── resolveTodayRow ───────────────────────────────────────────────────────────

/**
 * Lazy-upsert today's ReservationDay row for a non-blocked reservation.
 *
 * The default operationalStatus for a freshly-created row is OP_EXPECTED,
 * EXCEPT for same-day-only operational kinds that already reflect the parent:
 * - Walk-ins (OP_WALKED_IN): mirror the parent's status on create.
 * - Comp beds (OP_COMP): mirror the parent's status on create.
 *
 * OP_BLOCKED is NEVER given a day row — callers must skip blocked reservations.
 *
 * Returns the upserted row.
 */
export async function resolveTodayRow(
  reservation: {
    id: string
    operationalStatus: string
    checkedInAt?: Date | null
  },
  site: SiteForDay,
): Promise<ReservationDayRow> {
  const tz = toSiteTimezone(site)
  const todayKey = siteDayKey(tz)

  // Determine the initial operationalStatus for a freshly-created row.
  // Walk-ins and comps are already "arrived" kinds — mirror parent on create.
  const initialStatus = (
    reservation.operationalStatus === OP_WALKED_IN ||
    reservation.operationalStatus === OP_COMP
  )
    ? reservation.operationalStatus
    : OP_EXPECTED

  const row = await prisma.reservationDay.upsert({
    where: {
      reservationId_date: {
        reservationId: reservation.id,
        date: new Date(todayKey),
      },
    },
    create: {
      reservationId: reservation.id,
      date: new Date(todayKey),
      operationalStatus: initialStatus,
      checkedInAt: reservation.operationalStatus === OP_WALKED_IN
        ? (reservation.checkedInAt ?? null)
        : null,
      departedAt: null,
    },
    update: {}, // no-op if the row already exists — keep what's there
  })

  return row as ReservationDayRow
}

// ── applyDayTransition ────────────────────────────────────────────────────────

/**
 * Apply an operational state transition to TODAY's ReservationDay row AND
 * mirror it onto the legacy Reservation fields in a single transaction.
 *
 * This is the expand/parallel-write path: both the new per-day row and the
 * old per-reservation fields are written together so legacy readers (dashboard,
 * emails, detail pages) continue to work until P4 removes them.
 */
export async function applyDayTransition(
  reservation: { id: string },
  site: SiteForDay,
  transition: {
    operationalStatus: string
    checkedInAt?: Date | null
    departedAt?: Date | null
  },
): Promise<ReservationDayRow> {
  const tz = toSiteTimezone(site)
  const todayKey = siteDayKey(tz)

  const [updatedDay] = await prisma.$transaction([
    // 1. Upsert today's per-day row with the new state.
    prisma.reservationDay.upsert({
      where: {
        reservationId_date: {
          reservationId: reservation.id,
          date: new Date(todayKey),
        },
      },
      create: {
        reservationId: reservation.id,
        date: new Date(todayKey),
        operationalStatus: transition.operationalStatus,
        checkedInAt: transition.checkedInAt ?? null,
        departedAt: transition.departedAt ?? null,
      },
      update: {
        operationalStatus: transition.operationalStatus,
        ...(transition.checkedInAt !== undefined ? { checkedInAt: transition.checkedInAt } : {}),
        ...(transition.departedAt !== undefined ? { departedAt: transition.departedAt } : {}),
      },
    }),
    // 2. Mirror onto legacy Reservation fields (expand/parallel-write).
    prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        operationalStatus: transition.operationalStatus,
        ...(transition.checkedInAt !== undefined ? { checkedInAt: transition.checkedInAt } : {}),
        ...(transition.departedAt !== undefined ? { departedAt: transition.departedAt } : {}),
      },
    }),
  ])

  return updatedDay as ReservationDayRow
}
