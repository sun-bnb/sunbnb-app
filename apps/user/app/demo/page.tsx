'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import directQr from './direct-qr-min.png'
import remoteQr from './remote-qr-min.png'
import inAdvance from './in-advance-min.png'


type IconProps = {
  className?: string
}

const IconSun = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

const IconMapPin = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 10c0 5.25-8 12-8 12s-8-6.75-8-12a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const IconDashboard = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

const IconScan = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 4h4" />
    <path d="M4 20h4" />
    <path d="M16 4h4" />
    <path d="M16 20h4" />
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M9 9h2v6H9zM13 9h2v6h-2z" />
  </svg>
)

const IconPayment = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
    <path d="M6 15h2" />
    <path d="M10 15h2" />
  </svg>
)

const IconSmile = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M9 10h.01" />
    <path d="M15 10h.01" />
    <path d="M8 15s1.5 2 4 2 4-2 4-2" />
  </svg>
)

const DEVICE_RATIO = 1179 / 2556
const PHONE_HEIGHT = 1080
const PHONE_WIDTH = Math.round(PHONE_HEIGHT * DEVICE_RATIO)
const PHONE_VERTICAL_BEZEL = 90
const SCREEN_HEIGHT = PHONE_HEIGHT - PHONE_VERTICAL_BEZEL * 2
const IDEAL_SCREEN_WIDTH = SCREEN_HEIGHT * DEVICE_RATIO
const PHONE_HORIZONTAL_BEZEL = Math.max(0, Math.round((PHONE_WIDTH - IDEAL_SCREEN_WIDTH) / 2))
const SCREEN_WIDTH = PHONE_WIDTH - PHONE_HORIZONTAL_BEZEL * 2

type DemoScenario = {
  id: string
  label: string
  path: string
  illustration: ReactNode
  content: ReactNode
  introVideo?: string
}

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'reservation-advance',
    label: 'Reserve In Advance',
    path: '/',
    illustration: <Image src={inAdvance} alt="Illustration of reserving beach chairs in advance" className="h-auto w-[200px] max-w-full object-contain drop-shadow-[0_18px_32px_rgba(15,16,19,0.25)]" />,
    content: (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-white/70 p-3 text-base leading-relaxed text-slate-600 lg:text-lg">
          <p>
            Choose a beach from anywhere in the world, pick the exact chairs you want, and lock them in before you even
            pack your bags.
          </p>
        </div>
        <ul className="space-y-3 text-base text-slate-700 lg:text-lg">
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconMapPin className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Pick the perfect beach:</strong>{' '}
              search by location, vibe, or amenities in seconds.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconSmile className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Show up and relax:</strong>{' '}
              instant email, wallet pass, and QR confirmation so check-in takes seconds.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconDashboard className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Plan extras too:</strong>{' '}
              add towels, welcome drinks, or late checkout while you book.
            </div>
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'direct-qr',
    label: 'Direct QR Reservation',
    path: '/sites/cmbhmy2uu000012zrrzih3zzu/pos/cmblyd5aa006rzb3ye90up858',
    introVideo: 'https://9vo2eopfbefycklx.public.blob.vercel-storage.com/POV_Video_Generation_From_QR_Code.mp4',
    illustration: <Image src={directQr} alt="Illustration of direct QR code beach chair reservation" className="h-auto w-[200px] max-w-full object-contain drop-shadow-[0_18px_32px_rgba(15,16,19,0.25)]" />,
    content: (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-white/70 p-3 text-base leading-relaxed text-slate-600 lg:text-lg">
          <p>
            Spot an empty chair, scan the QR on its arm, and it is yours. No cash, no lines, all done in a few taps.
          </p>
        </div>
        <ul className="space-y-3 text-base text-slate-700 lg:text-lg">
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconScan className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Scan and sit:</strong>{' '}
              walk up, scan the QR, pick the time, and slide into the chair.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconPayment className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Tap to pay:</strong>{' '}
              every booking is digital—no coins, no ATMs, no receipts to lose.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconSmile className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Staff stay free:</strong>{' '}
              attendants just check the booking and smile—everything else is handled.
            </div>
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'remote-qr',
    label: 'Remote QR Reservation',
    path: '/sites/cmbhmy2uu000012zrrzih3zzu/pos',
    introVideo: 'https://9vo2eopfbefycklx.public.blob.vercel-storage.com/Pov_video_from_202601181425_6llc7.mp4',
    illustration: <Image src={remoteQr} alt="Illustration of remote QR code beach chair reservation" className="h-auto w-[200px] max-w-full object-contain drop-shadow-[0_18px_32px_rgba(15,16,19,0.25)]" />,
    content: (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-white/70 p-3 text-base leading-relaxed text-slate-600 lg:text-lg">
          <p>
            See a poster in a hotel lobby, beach bar, or city ad. Scan the QR to jump straight into that venue’s chair map
            and claim your spot before you walk over.
          </p>
        </div>
        <ul className="space-y-3 text-base text-slate-700 lg:text-lg">
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconMapPin className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Go straight to the venue:</strong>{' '}
              every QR points to a specific beach, so you are in the right place instantly.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconDashboard className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">See the chair map:</strong>{' '}
              browse the live layout, spot the best view, and tap to reserve.
            </div>
          </li>
          <li className="flex items-start gap-3 rounded-2xl bg-white/60 px-4 py-3">
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff1d0] text-slate-800">
              <IconSun className="h-5 w-5 text-slate-700" />
            </span>
            <div className="leading-relaxed">
              <strong className="font-semibold text-slate-900">Turn ads into seats:</strong>{' '}
              restaurants, hotels, and street campaigns can turn any flyer or menu into instant bookings.
            </div>
          </li>
        </ul>
      </div>
    ),
  },
]

export default function DemoPage() {

  const firstDemo = DEMO_SCENARIOS[0]

  if (!firstDemo) {
    return null
  }

  const [selectedDemoId, setSelectedDemoId] = useState<string>(firstDemo.id)
  const [videoFinished, setVideoFinished] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timeUpdateHandlerRef = useRef<(() => void) | null>(null)

  const activeDemo = DEMO_SCENARIOS.find((demo) => demo.id === selectedDemoId) ?? firstDemo
  
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { demoMode } = sitesState
  
  console.log('Demo page demo mode', demoMode)

  useEffect(() => {
    console.log('Setting demo mode true')
    window.localStorage.setItem('demoMode', 'true')
    dispatch(setValue({ demoMode: true }))         
  }, [])

  useEffect(() => {
    setVideoFinished(false)
    const videoEl = videoRef.current
    if (videoEl) {
      videoEl.currentTime = 0
      if (timeUpdateHandlerRef.current) {
        videoEl.removeEventListener('timeupdate', timeUpdateHandlerRef.current)
        timeUpdateHandlerRef.current = null
      }
    }
  }, [selectedDemoId])

  useEffect(() => {
    return () => {
      const videoEl = videoRef.current
      if (videoEl && timeUpdateHandlerRef.current) {
        videoEl.removeEventListener('timeupdate', timeUpdateHandlerRef.current)
        timeUpdateHandlerRef.current = null
      }
    }
  }, [])

  return (
    <div className="flex h-[1080px] w-full flex-col overflow-hidden bg-[#fff5e1] text-slate-900 lg:flex-row lg:justify-between">
      <section className="flex flex-1 flex-col gap-6 px-8 py-8 lg:px-14">
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Sunbnb mission</span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 lg:text-4xl">Beach time, booked in seconds.</h1>
          <p className="max-w-2xl text-base leading-relaxed text-slate-700 lg:text-lg">
            Sunbnb makes every lounger, cabana, and beach bed easy to find and easier to book. Pick a demo below to see
            how we help guests relax faster, keep staff focused on service, and make every venue smarter.
          </p>
        </div>

        <div className="grid gap-3 rounded-3xl bg-white/70 p-5 text-slate-800 shadow-[0_18px_36px_-32px_rgba(15,16,19,0.35)] sm:grid-cols-3">
          <figure className="flex flex-col gap-2 rounded-2xl bg-[#fff1d0] p-3">
            <div className="flex items-center gap-2">
              <IconSun className="h-7 w-7 text-slate-900" />
              <figcaption className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">Guests</figcaption>
            </div>
            <p className="text-sm leading-relaxed lg:text-base">
              Tap, map, and book from home, the hotel lobby, or right on the sand.
            </p>
          </figure>
          <figure className="flex flex-col gap-2 rounded-2xl bg-[#ffe4a3] p-3">
            <div className="flex items-center gap-2">
              <IconDashboard className="h-7 w-7 text-slate-900" />
              <figcaption className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">Venues</figcaption>
            </div>
            <p className="text-sm leading-relaxed lg:text-base">
              Real-time chair availability, fewer cash payments, and happier teams.
            </p>
          </figure>
          <figure className="flex flex-col gap-2 rounded-2xl bg-[#ffcf70] p-3">
            <div className="flex items-center gap-2">
              <IconMapPin className="h-7 w-7 text-slate-900" />
              <figcaption className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">Operations</figcaption>
            </div>
            <p className="text-sm leading-relaxed lg:text-base">
              QR codes, live dashboards, and instant confirmations keep the beach running smooth.
            </p>
          </figure>
        </div>

        <nav className="flex flex-wrap items-center gap-3" aria-label="Demo scenarios">
          {DEMO_SCENARIOS.map((demo) => {
            const isActive = demo.id === activeDemo.id
            return (
              <button
                key={demo.id}
                type="button"
                onClick={() => setSelectedDemoId(demo.id)}
                aria-pressed={isActive}
                className={`rounded-full border px-5 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 focus:ring-offset-[#fff5e1] ${
                  isActive
                    ? 'border-slate-900 bg-slate-900 text-[#fff5e1]'
                    : 'border-slate-300 bg-white/70 text-slate-700 hover:border-slate-900/60 hover:bg-white'
                }`}
              >
                {demo.label}
              </button>
            )
          })}
        </nav>

        <article className="flex flex-col gap-6 rounded-3xl bg-white/80 p-6 shadow-[0_26px_48px_-32px_rgba(15,16,19,0.35)]">
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
            <div className="flex items-center justify-center rounded-[1.75rem] bg-[#ffe9c2] p-6">
              {activeDemo.illustration}
            </div>
            <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-semibold text-slate-900 lg:text-3xl">{activeDemo.label}</h2>
              {activeDemo.content}
            </div>
          </div>
        </article>
      </section>

      <aside className="flex flex-col items-center justify-start bg-[#fff5e1] lg:sticky lg:top-0 lg:ml-auto lg:h-full lg:flex-none">
        {activeDemo.introVideo && !videoFinished ? (
          <div
            className="flex items-center justify-center"
            style={{ height: `${PHONE_HEIGHT}px`, width: `${PHONE_WIDTH}px` }}
          >
            <div className="relative h-full w-full overflow-hidden rounded-[2.4rem] bg-[#fff5e1] drop-shadow-[0_26px_48px_-32px_rgba(15,16,19,0.35)]">
              <video
                key={`${activeDemo.id}-intro`}
                src={activeDemo.introVideo}
                ref={videoRef}
                className="h-full w-full object-cover"
                onLoadedMetadata={(event) => {
                  const videoElement = event.currentTarget
                  if (!videoElement.duration || videoElement.duration === Infinity) {
                    return
                  }

                  const leadTimeSeconds = 1.5
                  const cutoff = Math.max(videoElement.duration - leadTimeSeconds, 0)

                  const handleTimeUpdate = () => {
                    if (videoElement.currentTime >= cutoff) {
                      setVideoFinished(true)
                      videoElement.removeEventListener('timeupdate', handleTimeUpdate)
                      timeUpdateHandlerRef.current = null
                    }
                  }

                  videoElement.addEventListener('timeupdate', handleTimeUpdate)
                  timeUpdateHandlerRef.current = handleTimeUpdate
                }}
                onEnded={() => setVideoFinished(true)}
                style={{ backgroundColor: '#fff5e1' }}
                autoPlay
                muted
                playsInline
              />
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-[84px] bg-[#fff5e1]" />
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[86px] bg-[#fff5e1]" />
            </div>
          </div>
        ) : (
          <div
            className="flex items-center justify-center"
            style={{ height: `${PHONE_HEIGHT}px`, width: `${PHONE_WIDTH}px` }}
          >
            <div
              className="relative flex h-full w-full flex-col items-center overflow-hidden rounded-[2.8rem] bg-gradient-to-br from-[#0f1013] to-[#1b1c20] shadow-[0_40px_80px_-32px_rgba(0,0,0,0.7),0_0_0_2px_rgba(255,255,255,0.04)]"
              style={{ padding: `${PHONE_VERTICAL_BEZEL}px ${PHONE_HORIZONTAL_BEZEL}px` }}
            >
              <div className="pointer-events-none absolute left-1/2 top-[22px] flex h-[30px] w-[42%] -translate-x-1/2 items-center justify-center gap-[14px] rounded-[1.25rem] bg-black">
                <span className="h-[14px] w-[14px] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(81,132,255,0.6),rgba(20,30,50,0.9))]" />
                <span className="h-[8px] w-[70px] rounded-full bg-slate-500/70" />
              </div>
              <iframe
                key={activeDemo.id}
                src={activeDemo.path}
                title={`${activeDemo.label} preview`}
                className="h-full w-full rounded-[1.6rem] border border-white/10 shadow-inner"
                style={{ width: `${SCREEN_WIDTH}px`, height: `${SCREEN_HEIGHT}px` }}
                loading="lazy"
              />
              <div className="pointer-events-none absolute bottom-6 left-1/2 h-[7px] w-[36%] -translate-x-1/2 rounded-full bg-white/60" />
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
