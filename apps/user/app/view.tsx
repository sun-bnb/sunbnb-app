'use client'

/**
 * Landing page — a day at the beach, told by scrolling.
 *
 * The whole top of the page is one WebGL beach club (`BeachStage` →
 * `BeachScene`), pinned while the page scrolls through ~5.5 screens. The copy
 * is a handful of panels fading in and out over it at scroll positions that
 * match what the camera is doing: the map at rest, the club standing up into
 * 3D, noon by the pole and its code plaque, golden hour with drinks on the
 * table, dusk with the lights coming on for the closing call to action. The
 * verifiable facts and the footer follow on a dusk-dark section so the day
 * ends rather than snapping back to cream.
 *
 * Nothing on this page is claimed that cannot be checked: the earlier
 * "100+ beaches" / 10k bookings / 4.8★ / testimonial copy is gone for good.
 *
 * Type: Fraunces (soft/wonky optical serif) for display, Geist for everything
 * else, loaded here so the rest of the app is untouched. Panels animate with
 * CSS only — `--p` is written once per scroll frame by BeachStage, and each
 * panel's opacity is `clamp()` math on it, so scrolling never re-renders React.
 */

import Image from 'next/image'
import { Fraunces } from 'next/font/google'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { CSSProperties, ReactNode } from 'react'

import SearchBar from '@/components/search/search-bar'
import BeachStage from '@/components/landing/beach-stage'
import sunbnbHorizontalBlack from './sunbnb-horizontal-black.png'

const display = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--sb-display',
})

interface BusinessEntity {
  companyName: string
  companyAddress: string | null
  businessId: string | null
  vatId: string | null
  contactEmail: string | null
  contactPhone: string | null
}

/** Scroll windows (fractions of the stage): fade in over [a,b], out over [c,d]. */
const BEATS = {
  hero: [-0.02, 0, 0.07, 0.13], // fully in at p = 0 (a window starting AT 0 is invisible at rest)
  hint: [-0.02, 0, 0.01, 0.05],
  stage1: [0.13, 0.18, 0.31, 0.36], // the flyover and the travel to the seat
  stage2: [0.38, 0.43, 0.6, 0.65], // arriving: the plaque is in view, and stays while we turn around it
  stage3: [0.68, 0.73, 0.84, 0.88], // the turn around the drinks
  close: [0.94, 0.985, 1.5, 1.6], // stays once it is in
} as const

/** The pointer-event windows BeachStage switches between — hoisted so the stage's scroll effect binds once. */
const BEAT_WINDOWS: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(BEATS)
    .filter(([k]) => k !== 'hint')
    .map(([k, [a, , , d]]) => [k, [a, d] as [number, number]]),
)

/**
 * A copy panel over the stage. Visible when `--p` is inside its window; the
 * fade is computed in CSS from the slopes below, so scroll costs no React work.
 * Pointer events are enabled only while the panel is (mostly) visible, else a
 * hidden panel would eat the hovers meant for the beach behind it.
 */
function Panel({
  beat,
  className,
  children,
}: {
  beat: keyof typeof BEATS
  className?: string
  children: ReactNode
}) {
  const [a, b, c, d] = BEATS[beat]
  const style = {
    '--a': a,
    '--ka': b > a ? 1 / (b - a) : 1e6,
    '--d': d,
    '--kd': d > c ? 1 / (d - c) : 1e6,
  } as CSSProperties
  return (
    <div className={`lp-panel absolute ${className ?? ''}`} style={style} data-beat={beat}>
      {children}
    </div>
  )
}

export default function HomeView({ businessEntity }: { businessEntity: BusinessEntity }) {
  const router = useRouter()
  const t = useTranslations('LandingPage')
  const facts = ['fact1', 'fact2', 'fact3', 'fact4'] as const

  return (
    <div className={`${display.variable} lp-root bg-cream font-sans`}>
      <style>{`
        .lp-root {
          --lp-ink: #17323a;
          --lp-straw: #7a6029;
          --lp-sea: #046b7d;
          --lp-dusk: #272b46;
          color: var(--lp-ink);
        }
        .lp-display {
          font-family: var(--sb-display), Georgia, serif;
          font-variation-settings: 'SOFT' 80, 'WONK' 1, 'opsz' 144;
          font-weight: 700;
          letter-spacing: -0.025em;
        }
        .lp-stage-label {
          font-family: var(--sb-display), Georgia, serif;
          font-variation-settings: 'SOFT' 100, 'WONK' 1, 'opsz' 14;
          font-weight: 600;
          font-style: italic;
        }
        .lp-link {
          color: var(--lp-sea);
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-thickness: 1px;
        }
        .lp-link:hover { color: var(--lp-ink); }

        /* panel visibility: min(fade-in slope, fade-out slope), clamped — pure CSS on --p */
        .lp-panel {
          --o: clamp(0, min((var(--p) - var(--a)) * var(--ka), (var(--d) - var(--p)) * var(--kd)), 1);
          opacity: var(--o);
          transform: translateY(calc((1 - var(--o)) * 22px));
          pointer-events: none;
          will-change: opacity, transform;
        }
        .lp-panel > * { pointer-events: auto; }
        /* while a panel is faded out, its controls must not intercept the beach */
        .lp-panel[data-beat] { visibility: hidden; }
        .lp-stage[data-beat="hero"]   .lp-panel[data-beat="hero"],
        .lp-stage[data-beat="hero"]   .lp-panel[data-beat="hint"],
        .lp-stage[data-beat="stage1"] .lp-panel[data-beat="stage1"],
        .lp-stage[data-beat="stage2"] .lp-panel[data-beat="stage2"],
        .lp-stage[data-beat="stage3"] .lp-panel[data-beat="stage3"],
        .lp-stage[data-beat="close"]  .lp-panel[data-beat="close"] { visibility: visible; }

        .lp-glass {
          background: rgba(255, 245, 225, 0.82);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(122, 96, 41, 0.18);
          box-shadow: 0 10px 40px rgba(23, 50, 58, 0.08);
        }
        .lp-glass-dusk {
          background: rgba(23, 50, 58, 0.62);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 245, 225, 0.14);
          color: #fdf6e6;
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-panel { transform: none; transition: none; }
        }
        /* the docked search: fixed to the viewport, hidden only while the hero's own search is up */
        .lp-dock {
          opacity: 0;
          transform: translateY(14px);
          pointer-events: none;
          transition: opacity 320ms ease, transform 320ms ease;
        }
        .lp-stage:not([data-beat="hero"]) .lp-dock { opacity: 1; transform: none; }
        .lp-stage:not([data-beat="hero"]) .lp-dock > * { pointer-events: auto; }
        @media (prefers-reduced-motion: reduce) { .lp-dock { transition: none; transform: none; } }
        @keyframes lpHint { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        .lp-hint-arrow { animation: lpHint 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .lp-hint-arrow { animation: none; } }
      `}</style>

      {/* ── The day ─────────────────────────────────────────────────────── */}
      <BeachStage
        heightVh={560}
        yoursLabel={t('planYours')}
        label={t('planAria')}
        beats={BEAT_WINDOWS}
      >
        {/* Hero: the headline over the sand of the map */}
        <Panel beat="hero" className="inset-x-0 bottom-0 top-14 flex items-end md:items-center">
          <div className="w-full px-5 pb-[9svh] md:px-8 md:pb-0">
            <div className="mx-auto max-w-6xl">
              <div className="relative max-w-[600px] rounded-[26px] p-6 md:-ml-6 md:p-8 lg:p-10 lp-glass md:bg-[rgba(255,245,225,0.72)]">
                <h1 className="lp-display text-[clamp(2.7rem,8.5vw,5.1rem)] leading-[0.92]">
                  {t('heroLine1')}
                  <br />
                  {t('heroLine2')}
                </h1>
                <p className="mt-5 max-w-[44ch] text-[15.5px] leading-relaxed text-[#3f5157] md:text-[17.5px]">
                  {t('heroLead')}
                </p>
                <div className="relative z-10 mt-7 max-w-md">
                  <SearchBar />
                  <p className="mt-3 text-[13px] text-[#4f6065]">
                    {t('searchHint')}{' '}
                    <button type="button" onClick={() => router.push('/sites')} className="lp-link font-medium">
                      {t('browseAll')}
                    </button>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel beat="hint" className="inset-x-0 bottom-4 flex justify-center text-center md:bottom-6">
          <div className="flex flex-col items-center gap-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#4f6065]">
            <span>{t('scrollHint')}</span>
            <svg className="lp-hint-arrow h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </Panel>

        {/* Beat 1 — late morning, the map stands up */}
        <Panel beat="stage1" className="inset-x-0 bottom-0 md:inset-y-0 md:left-auto md:right-0 md:flex md:w-1/2 md:items-center">
          <div className="px-5 pb-[21svh] md:px-8 md:pb-0 lg:pr-[max(2rem,calc((100vw-72rem)/2))]">
            <StageCopy
              label={t('stage1Label')}
              title={t('stage1Title')}
              desc={t('stage1Desc')}
              cta={{ label: t('stage1Cta'), onClick: () => router.push('/sites') }}
            />
          </div>
        </Panel>

        {/* Beat 2 — noon, at the pole */}
        <Panel beat="stage2" className="inset-x-0 bottom-0 md:inset-y-0 md:right-auto md:left-0 md:flex md:w-1/2 md:items-center">
          <div className="px-5 pb-[21svh] md:px-8 md:pb-0 lg:pl-[max(2rem,calc((100vw-72rem)/2))]">
            <StageCopy label={t('stage2Label')} title={t('stage2Title')} desc={t('stage2Desc')} />
          </div>
        </Panel>

        {/* Beat 3 — golden hour, on the lounger */}
        <Panel beat="stage3" className="inset-x-0 bottom-0 md:inset-y-0 md:left-auto md:right-0 md:flex md:w-1/2 md:items-center">
          <div className="px-5 pb-[21svh] md:px-8 md:pb-0 lg:pr-[max(2rem,calc((100vw-72rem)/2))]">
            <StageCopy label={t('stage3Label')} title={t('stage3Title')} desc={t('stage3Desc')} />
          </div>
        </Panel>

        {/* Docked search — takes over from the hero's and stays for the rest of the page */}
        <div className="lp-dock fixed inset-x-0 bottom-3 z-30 flex justify-center px-3 md:bottom-5">
          <div className="lp-glass w-full max-w-xl rounded-2xl p-2">
            <SearchBar className="flex flex-col-reverse" />
            <p className="mt-1.5 px-1 text-center text-[12px] text-[#4f6065]">
              {t('searchHint')}{' '}
              <button type="button" onClick={() => router.push('/sites')} className="lp-link font-medium">
                {t('browseAll')}
              </button>
            </p>
          </div>
        </div>

        {/* Close — dusk */}
        <Panel beat="close" className="inset-0 flex items-center">
          <div className="w-full px-5 pb-[10svh] md:px-8 md:pb-0">
            <div className="mx-auto max-w-xl rounded-[26px] p-7 text-center md:p-10 lp-glass-dusk">
              <h2 className="lp-display text-[clamp(2.1rem,6vw,3.4rem)] leading-[1]">{t('ctaTitle')}</h2>
              <p className="mx-auto mt-4 max-w-[42ch] text-[15px] leading-relaxed text-[#c9d6dc] md:text-[16px]">
                {t('ctaDesc')}
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => router.push('/sites')}
                  className="rounded-xl bg-[#fdf6e6] px-7 py-3 text-sm font-semibold text-[#17323a] transition-colors hover:bg-white"
                >
                  {t('ctaExplore')}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/sign-in')}
                  className="rounded-xl border border-[rgba(253,246,230,0.35)] px-7 py-3 text-sm font-medium text-[#e6edf0] transition-colors hover:border-[rgba(253,246,230,0.7)] hover:text-white"
                >
                  {t('ctaSignIn')}
                </button>
              </div>
              <p className="mt-7 text-[13px] text-[#a9bcc3]">
                {t('ctaPartner')}{' '}
                <a
                  href="https://partner.sunbnb.app"
                  className="font-medium text-[#8fe3f2] underline underline-offset-[3px] hover:text-white"
                >
                  {t('ctaBecomePartner')}
                </a>
              </p>
            </div>
          </div>
        </Panel>
      </BeachStage>

      {/* ── After dark: what is actually true, and the footer ───────────── */}
      <section className="bg-[var(--lp-dusk)] text-[#fdf6e6]">
        <div className="mx-auto max-w-6xl px-5 pb-6 pt-14 md:px-8 md:pt-20">
          <dl className="grid grid-cols-1 gap-y-9 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-4 lg:gap-x-0">
            {facts.map((fact, i) => (
              <div
                key={fact}
                className={`border-[rgba(253,246,230,0.14)] lg:px-7 ${i > 0 ? 'lg:border-l' : ''} ${
                  i === 0 ? 'lg:pl-0' : ''
                } ${i === facts.length - 1 ? 'lg:pr-0' : ''}`}
              >
                <dt className="lp-display text-[17px] leading-snug md:text-[19px]">
                  {t(`${fact}Title` as Parameters<typeof t>[0])}
                </dt>
                <dd className="mt-2 max-w-[34ch] text-[14px] leading-relaxed text-[#b9c6cc]">
                  {t(`${fact}Desc` as Parameters<typeof t>[0])}
                  {fact === 'fact2' && (
                    <>
                      {' '}
                      <a
                        href="/cancellation-policy"
                        className="text-[#8fe3f2] underline underline-offset-[3px] hover:text-white"
                      >
                        {t('fact2Link')}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* extra bottom room: the docked search is fixed over the page bottom */}
        <footer className="mx-auto max-w-6xl px-5 pb-32 pt-10 md:px-8 md:pb-36 md:pt-14">
          <div className="flex flex-col gap-5 border-t border-[rgba(253,246,230,0.14)] pt-8 sm:flex-row sm:items-center sm:justify-between">
            <Image src={sunbnbHorizontalBlack} alt="Sunbnb" className="w-[96px] opacity-70 invert" />
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[#b9c6cc]">
              <a href="/tos" className="hover:text-white">{t('footerTerms')}</a>
              <a href="/privacy" className="hover:text-white">{t('footerPrivacy')}</a>
              <a href="/cancellation-policy" className="hover:text-white">{t('footerCancellation')}</a>
              <a href="https://partner.sunbnb.app" className="hover:text-white">{t('footerPartners')}</a>
            </nav>
          </div>
          <p className="mt-6 text-[12px] leading-relaxed text-[#8d9ca3]">
            © {new Date().getFullYear()} Sunbnb · {t('operatedBy')} {businessEntity.companyName}
            {businessEntity.businessId ? ` · ${t('businessId')} ${businessEntity.businessId}` : ''}
            {businessEntity.companyAddress ? ` · ${businessEntity.companyAddress}` : ''}
          </p>
        </footer>
      </section>
    </div>
  )
}

function StageCopy({
  label,
  title,
  desc,
  cta,
}: {
  label: string
  title: string
  desc: string
  cta?: { label: string; onClick: () => void }
}) {
  return (
    <div className="max-w-[520px] rounded-[24px] p-6 md:p-8 lp-glass">
      <p className="lp-stage-label text-[15px] text-[var(--lp-straw)] md:text-[17px]">{label}</p>
      <h2 className="lp-display mt-2 text-[clamp(1.6rem,3.6vw,2.3rem)] leading-[1.08]">{title}</h2>
      <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-[#3f5157] md:text-[16px]">{desc}</p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-6 rounded-xl bg-[#17323a] px-5 py-2.5 text-sm font-semibold text-[#fffdf7] transition-colors hover:bg-[#0f242a]"
        >
          {cta.label}
        </button>
      )}
    </div>
  )
}
