'use client'

/**
 * Alcúdia — bespoke brand page (track 023 P5, customer #1).
 *
 * The design thesis is the beach's one famous truth: the water stays SHALLOW.
 * You can walk a hundred metres out and still stand. So the page is a slow
 * wade — it opens on dry sand and each section is a step deeper, separated by
 * bathymetric contour lines with measured depths, until the footer past the
 * sandbar. The booking panel keeps its own constant pale surface throughout:
 * the raft you can always climb onto.
 *
 * Three typographic voices, each with one job:
 *   - Bricolage Grotesque  — the shout: brand name, section heads, big numbers
 *   - Source Serif 4       — the holiday prose
 *   - Spline Sans Mono     — the measuring voice: depths, hours, counts, codes
 *
 * Copy is hand-written English (a bespoke page is authored, not translated);
 * place names stay Catalan. Live values — price, bed count, parasol count,
 * hours, availability — come from the site payload, never from copy, so the
 * page cannot drift from the venue it sells.
 *
 * The cover photo is © Bengt Nyman, CC BY 3.0 (Wikimedia Commons) — an
 * attribution-only licence, and this page is where the credit travels.
 */

import { useEffect } from 'react'
import { Bricolage_Grotesque, Source_Serif_4, Spline_Sans_Mono } from 'next/font/google'
import Image from 'next/image'
import dayjs from 'dayjs'
import { useDispatch } from 'react-redux'

import BookingSurface from '@/components/booking/BookingSurface'
import { setValue } from '@/store/features/sites/sitesSlice'
import type { BrandPageProps } from '../types'

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--alc-display' })
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['400', '600'], style: ['normal', 'italic'], variable: '--alc-serif' })
const mono = Spline_Sans_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--alc-mono' })

// ── Palette: water-first. Ink is pine-over-deep-water; straw is the thatch. ──
const INK = '#16383B'
const PAGE = '#FBF8F1'
const BANDS = ['#EDF6F1', '#D9EEE8', '#C0E2DC'] as const
const DEEP = '#0D444C'
const DEEP_TEXT = '#D8ECE8'
const STRAW = '#B98A3C'
const SEA = '#1F7F8A'

/** The nine operator zones, north (the port) to south, as painted on their signs. */
const ZONES = ['XARA I', 'XARA II', 'PRINCESA', 'SUNWING', 'PUTXET', 'C.B. I', 'C.B. II', 'BOCCACCIO', 'COMTESSA']

/** A bathymetric contour: one gentle line between depths, with its measurement. */
function Contour({ depth, note }: { depth: string; note: string }) {
  return (
    <div className="alc-contour relative my-2 select-none" aria-hidden="true">
      <svg viewBox="0 0 1200 26" preserveAspectRatio="none" className="block h-[26px] w-full" fill="none">
        <path
          d="M0,13 C60,5 140,21 220,13 S380,5 460,13 S620,21 700,13 S860,5 940,13 S1140,21 1200,13"
          stroke={SEA}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
      </svg>
      <span
        className="absolute left-6 top-1/2 -translate-y-1/2 px-2 text-[0.68rem] tracking-[0.18em]"
        style={{ fontFamily: 'var(--alc-mono)', color: SEA, backgroundColor: PAGE }}
      >
        {depth} · {note}
      </span>
    </div>
  )
}

export default function AlcudiaBrandPage({ site, apiKey, initialAvailableCount }: BrandPageProps) {
  const dispatch = useDispatch()

  // Paint the document itself, or the app shell's cream shows through on
  // overscroll — the same trick the standard branded view uses.
  useEffect(() => {
    document.body.style.backgroundColor = PAGE
    return () => { document.body.style.backgroundColor = '' }
  }, [])

  const items = site.inventoryItems ?? []
  const beds = items.length
  const parasols = new Set(items.map((i) => i.sunbedGroupId).filter(Boolean)).size || Math.round(beds / 2)
  const price = site.price != null ? `€${site.price.toFixed(2)}` : null

  // Hours from data, collapsed when uniform — the common case here.
  const hours = site.workingHours ?? []
  const span = (h: { openTime: Date; closeTime: Date }) =>
    `${dayjs(h.openTime).format('HH:mm')}–${dayjs(h.closeTime).format('HH:mm')}`
  const uniform = hours.length === 7 && new Set(hours.map(span)).size === 1 ? span(hours[0]!) : null
  const today = hours.find((h) => h.day === (dayjs().day() === 0 ? 7 : dayjs().day()))

  return (
    <div
      className={`${display.variable} ${serif.variable} ${mono.variable} min-h-screen`}
      style={{ backgroundColor: PAGE, color: INK }}
    >
      <style>{`
        .alc-eyebrow { font-family: var(--alc-mono); font-size: 0.7rem; letter-spacing: 0.2em; }
        .alc-prose { font-family: var(--alc-serif); line-height: 1.75; }
        @media (prefers-reduced-motion: no-preference) {
          .alc-rise { opacity: 0; transform: translateY(14px); animation: alcRise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
          .alc-rise:nth-child(2) { animation-delay: 80ms; }
          .alc-rise:nth-child(3) { animation-delay: 160ms; }
          .alc-rise:nth-child(4) { animation-delay: 240ms; }
          .alc-rise:nth-child(5) { animation-delay: 320ms; }
          @keyframes alcRise { to { opacity: 1; transform: none; } }
          .alc-contour svg { animation: alcDrift 16s ease-in-out infinite alternate; }
          @keyframes alcDrift { from { transform: translateX(-8px); } to { transform: translateX(8px); } }
        }
      `}</style>

      <div className="mx-auto max-w-[1200px] lg:flex lg:gap-10 lg:px-8">
        <main className="min-w-0 px-4 pb-4 lg:flex-[3] lg:px-0">
          {/* ── Dry sand: the hero ─────────────────────────────────────────── */}
          <header className="pb-10 pt-12 lg:pt-16">
            <p className="alc-eyebrow alc-rise" style={{ color: STRAW }}>
              39.83° N · 3.12° E — BADIA D&apos;ALCÚDIA, MALLORCA
            </p>
            <h1
              className="alc-rise mt-4 text-[clamp(3.2rem,9vw,5.8rem)] leading-[0.95] tracking-tight"
              style={{ fontFamily: 'var(--alc-display)', fontWeight: 800 }}
            >
              Platja
              <br />
              d&apos;Alcúdia
            </h1>
            <p className="alc-prose alc-rise mt-6 max-w-[52ch] text-[1.15rem]">
              Six kilometres of sand facing north into the calmest bay on the island. The water stays
              shallow for a hundred metres out — long enough for an afternoon to lose its shape
              entirely.
            </p>

            <div className="alc-rise mt-7 flex flex-wrap items-center gap-2">
              {today && (
                <span
                  className="rounded-full border px-3 py-1.5 text-[0.7rem] tracking-[0.14em]"
                  style={{ fontFamily: 'var(--alc-mono)', borderColor: `${INK}30` }}
                >
                  OPEN TODAY {span(today)}
                </span>
              )}
              {initialAvailableCount != null && (
                <span
                  className="rounded-full border px-3 py-1.5 text-[0.7rem] tracking-[0.14em]"
                  style={{ fontFamily: 'var(--alc-mono)', borderColor: `${SEA}55`, color: SEA }}
                >
                  {initialAvailableCount.toLocaleString('en-GB')} BEDS FREE TODAY
                </span>
              )}
            </div>

            {site.image && (
              <figure className="alc-rise mt-8">
                <Image
                  src={site.image}
                  width={site.imageWidth ?? 2400}
                  height={site.imageHeight ?? 873}
                  alt="Platja d'Alcúdia seen from the bay: rows of thatched parasols along the sand, pines behind"
                  className="w-full rounded-2xl"
                  priority
                />
                <figcaption
                  className="mt-2 text-[0.68rem] tracking-[0.14em]"
                  style={{ fontFamily: 'var(--alc-mono)', color: `${INK}99` }}
                >
                  TAKEN STANDING IN THE BAY, FIFTY METRES OUT — STILL KNEE-DEEP · © BENGT NYMAN
                </figcaption>
              </figure>
            )}

            {/* The funnel is always beside this page at lg; on a phone it lives
                in the drawer, so the invitation opens the real thing. */}
            <button
              type="button"
              onClick={() => dispatch(setValue({ focused: true }))}
              className="mt-8 w-full rounded-xl px-6 py-4 text-[1.05rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
              style={{
                fontFamily: 'var(--alc-display)',
                fontWeight: 700,
                backgroundColor: INK,
                color: PAGE,
                outlineColor: STRAW,
              }}
            >
              Reserve a sunbed
            </button>
          </header>

          <Contour depth="0.0 m" note="DRY SAND" />

          {/* ── Film of water: one price, every bed ────────────────────────── */}
          <section className="rounded-3xl px-6 py-9 sm:px-9" style={{ backgroundColor: BANDS[0] }}>
            <h2 className="text-[1.7rem]" style={{ fontFamily: 'var(--alc-display)', fontWeight: 700 }}>
              One price, every bed.
            </h2>
            <p className="alc-prose mt-4 max-w-[58ch]">
              This is a public beach. Every parasol shades two beds, and the front row costs no more
              than the last — {price ?? 'one price'} for the day, whether you arrive at nine or at
              four. Every parasol carries its printed code: scan it, and the bed under it is yours.
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
              {[
                [beds.toLocaleString('en-GB'), 'BEDS'],
                [parasols.toLocaleString('en-GB'), 'PARASOLS'],
                [String(ZONES.length), 'ZONES'],
                [price ?? '—', 'A DAY, ANY BED'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dd className="text-[2rem] leading-none" style={{ fontFamily: 'var(--alc-display)', fontWeight: 800 }}>
                    {value}
                  </dd>
                  <dt className="mt-1.5 text-[0.65rem] tracking-[0.18em]" style={{ fontFamily: 'var(--alc-mono)', color: `${INK}99` }}>
                    {label}
                  </dt>
                </div>
              ))}
            </dl>
          </section>

          <Contour depth="0.4 m" note="ANKLES" />

          {/* ── Ankle-deep: the shoreline ──────────────────────────────────── */}
          <section className="rounded-3xl px-6 py-9 sm:px-9" style={{ backgroundColor: BANDS[1] }}>
            <h2 className="text-[1.7rem]" style={{ fontFamily: 'var(--alc-display)', fontWeight: 700 }}>
              Where you land.
            </h2>
            <p className="alc-prose mt-4 max-w-[58ch]">
              The bay curves, and the beach curves with it. Nine zones run south from the port —
              pick one on the map and the rows are laid out exactly as they stand in the sand.
            </p>
            <div className="mt-7 overflow-x-auto pb-2" role="img" aria-label={`The nine beach zones in order: ${ZONES.join(', ')}`}>
              <div className="flex min-w-max items-start">
                {ZONES.map((zone, i) => (
                  <div key={zone} className="relative flex flex-col items-start pr-6 last:pr-0">
                    <div className="flex w-full items-center">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STRAW }} />
                      {i < ZONES.length - 1 && <span className="h-px w-full" style={{ backgroundColor: `${SEA}55` }} />}
                    </div>
                    <span className="mt-2 text-[0.6rem] tracking-[0.12em]" style={{ fontFamily: 'var(--alc-mono)' }}>
                      {zone}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[0.62rem] tracking-[0.16em]" style={{ fontFamily: 'var(--alc-mono)', color: `${INK}80` }}>
                PORT D&apos;ALCÚDIA → PLATJA DE MURO · 6 KM
              </p>
            </div>
          </section>

          <Contour depth="0.9 m" note="KNEES, STILL WALKING" />

          {/* ── Knee-deep: good to know ────────────────────────────────────── */}
          <section className="mb-10 rounded-3xl px-6 py-9 sm:px-9" style={{ backgroundColor: BANDS[2] }}>
            <h2 className="text-[1.7rem]" style={{ fontFamily: 'var(--alc-display)', fontWeight: 700 }}>
              Good to know.
            </h2>
            <dl className="mt-6 flex flex-col gap-6">
              <div>
                <dt className="text-[0.65rem] tracking-[0.18em]" style={{ fontFamily: 'var(--alc-mono)', color: `${INK}99` }}>
                  HOURS
                </dt>
                <dd className="alc-prose mt-1.5 max-w-[56ch]">
                  {uniform
                    ? `Every day, ${uniform.replace('–', ' to ')}. `
                    : 'Hours vary by day — the booking panel shows what applies. '}
                  Your bed is yours for the whole day of your booking.
                </dd>
              </div>
              {site.partialGroupBookingEnabled && (
                <div>
                  <dt className="text-[0.65rem] tracking-[0.18em]" style={{ fontFamily: 'var(--alc-mono)', color: `${INK}99` }}>
                    HALF OR WHOLE
                  </dt>
                  <dd className="alc-prose mt-1.5 max-w-[56ch]">
                    A parasol shades two beds. Take both, or just the one you need — the other stays
                    free for someone else.
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[0.65rem] tracking-[0.18em]" style={{ fontFamily: 'var(--alc-mono)', color: `${INK}99` }}>
                  WANDER
                </dt>
                <dd className="alc-prose mt-1.5 max-w-[56ch]">
                  Walk to lunch under the pines, swim out to the sandbar, come back at five — the bed
                  stays yours. Nobody flips a towel here.
                </dd>
              </div>
            </dl>
          </section>
        </main>

        {/* The raft: the platform's booking funnel, constant against the descent. */}
        {/* openOnMount off: on a phone this page IS the landing moment — the
            drawer stays at its peek until the guest asks for it (the CTA, the
            date field, or the pill), instead of covering the hero on arrival. */}
        <BookingSurface site={site} apiKey={apiKey} theme={{ background: '#FDFDFB', foreground: INK }} openOnMount={false} />
      </div>

      <Contour depth="2.0 m" note="PAST THE SANDBAR" />

      {/* ── The deep ─────────────────────────────────────────────────────── */}
      <footer className="mt-2 px-6 py-12" style={{ backgroundColor: DEEP, color: DEEP_TEXT }}>
        <div className="mx-auto max-w-[1200px] lg:px-2">
          <p className="text-[1.4rem]" style={{ fontFamily: 'var(--alc-display)', fontWeight: 700 }}>
            Past the sandbar.
          </p>
          <div className="mt-7 grid gap-8 text-[0.85rem] sm:grid-cols-3">
            <div style={{ fontFamily: 'var(--alc-mono)' }} className="text-[0.7rem] leading-6 tracking-[0.12em]">
              PLATJA D&apos;ALCÚDIA
              <br />
              BADIA D&apos;ALCÚDIA · MALLORCA
              <br />
              39.83° N · 3.12° E
            </div>
            <nav aria-label="Site" className="alc-prose flex flex-col gap-2">
              <a href="/s/alcudia/reservations" className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ textDecorationColor: `${DEEP_TEXT}55`, outlineColor: STRAW }}>
                My reservations
              </a>
              <a href="/tos" className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ textDecorationColor: `${DEEP_TEXT}55`, outlineColor: STRAW }}>
                Terms of service
              </a>
            </nav>
            <div className="alc-prose text-[0.85rem] leading-6" style={{ color: `${DEEP_TEXT}CC` }}>
              Beach photo ©{' '}
              <a href="https://commons.wikimedia.org/wiki/File:Alcudia_Beach_-_panoramio_-_Bengt_Nyman.jpg" className="underline underline-offset-4" style={{ textDecorationColor: `${DEEP_TEXT}55` }}>
                Bengt Nyman
              </a>
              ,{' '}
              <a href="https://creativecommons.org/licenses/by/3.0" className="underline underline-offset-4" style={{ textDecorationColor: `${DEEP_TEXT}55` }}>
                CC BY 3.0
              </a>
              . Booking runs on Sunbnb.
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
