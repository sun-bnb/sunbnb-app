'use client'

import Image from 'next/image'
import SearchBar from '@/components/search/search-bar'
import sunbnbHorizontalBlack from './sunbnb-horizontal-black.png'
import reservationScreen from './reservation-screen.png'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'

export default function HomeView() {

  const router = useRouter()

  return (
    <div className="bg-cream font-sans text-[#2d2d2d] pt-14 overflow-x-hidden">

      {/* Hero */}
      <section className="relative px-5 md:px-8 pt-10 md:pt-20 lg:pt-28 pb-6 md:pb-12 max-w-5xl mx-auto">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-10 -right-16 w-48 h-48 md:w-72 md:h-72 bg-brand-cyan/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 -left-20 w-40 h-40 md:w-64 md:h-64 bg-yellow-300/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/70 backdrop-blur-sm rounded-full border border-white/80 shadow-soft mb-5 md:mb-6">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-[11px] md:text-xs font-medium text-gray-500">Live availability</span>
          </div>

          <Image
            src={sunbnbHorizontalBlack}
            alt="Sunbnb logo"
            className="mx-auto mb-4 md:mb-6 w-[180px] md:w-[240px] lg:w-[280px]"
          />

          <h1 className="text-[28px] md:text-4xl lg:text-5xl font-bold leading-[34px] md:leading-tight tracking-tight mb-3 md:mb-4">
            Your place
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-cyan-400">
              under the sun
            </span>
          </h1>

          <p className="text-[15px] md:text-lg text-gray-500 leading-relaxed mb-6 md:mb-8 max-w-[280px] md:max-w-md mx-auto">
            Find a beach. Pick your sunbed.
            <br />
            Book in seconds.
          </p>
        </div>

        {/* Search */}
        <div className="relative z-10 w-full max-w-lg mx-auto">
          <SearchBar />
        </div>
      </section>

      {/* How It Works */}
      <section className="px-5 md:px-8 pt-8 md:pt-14 pb-2 max-w-3xl mx-auto">
        <p className="text-[11px] md:text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4 md:mb-6 text-center">How it works</p>
        <div className="flex gap-3 md:gap-5">
          {[
            { step: '1', emoji: '🔍', label: 'Find a beach' },
            { step: '2', emoji: '⛱️', label: 'Pick a sunbed' },
            { step: '3', emoji: '✅', label: 'Book & enjoy' },
          ].map((s, i) => (
            <div
              key={s.step}
              className="flex-1 bg-white rounded-2xl p-3.5 md:p-5 text-center border border-white shadow-soft animate-bubble-up"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <span className="text-xl md:text-2xl">{s.emoji}</span>
              <p className="text-[12px] md:text-sm font-semibold text-gray-700 mt-1.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature Cards */}
      <section className="px-5 md:px-8 pt-8 md:pt-14 max-w-5xl mx-auto space-y-4 md:space-y-0 md:grid md:grid-cols-3 md:gap-6">

        {/* Card 1 - Book Before You Go */}
        <div className="bg-white rounded-2xl overflow-hidden border border-white shadow-card md:hover:shadow-lg md:transition-shadow">
          <div className="relative h-44 md:h-52 overflow-hidden">
            <Image
              src={reservationScreen}
              width={600} height={300}
              alt="Reservation screen"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-cyan/90 rounded-full text-[10px] font-semibold text-white shadow-sm">
                🔍 PLAN AHEAD
              </span>
            </div>
          </div>
          <div className="p-4 pt-3">
            <h2 className="text-[16px] font-bold tracking-tight mb-1">Book before you go</h2>
            <p className="text-[13px] text-gray-500 leading-relaxed">
              Search your destination, browse the layout, and reserve the perfect spot — all before you leave home.
            </p>
          </div>
        </div>

        {/* Card 2 - Book on the Beach */}
        <div className="bg-white rounded-2xl overflow-hidden border border-white shadow-card md:hover:shadow-lg md:transition-shadow">
          <div className="relative h-44 md:h-52 overflow-hidden">
            <Image
              src="https://9vo2eopfbefycklx.public.blob.vercel-storage.com/public/front-page-section2-w34RgcJ5VOCKDUcshhbDlEjHghfATC.png"
              width={600} height={300}
              alt="QR code booking"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/90 rounded-full text-[10px] font-semibold text-white shadow-sm">
                ⛱️ ON THE BEACH
              </span>
            </div>
          </div>
          <div className="p-4 pt-3">
            <h2 className="text-[16px] font-bold tracking-tight mb-1">Scan & claim your sunbed</h2>
            <p className="text-[13px] text-gray-500 leading-relaxed">
              Already at the beach? Use the live map to pick a free sunbed, or scan the QR code right on the lounger.
            </p>
          </div>
        </div>

        {/* Card 3 - Order & Pay */}
        <div className="bg-white rounded-2xl overflow-hidden border border-white shadow-card md:hover:shadow-lg md:transition-shadow">
          <div className="relative h-44 md:h-52 overflow-hidden">
            <Image
              src="https://9vo2eopfbefycklx.public.blob.vercel-storage.com/public/front-page-section3-VXCLoOVCvTAIrMSAqkwt9Y5U720RKD.png"
              width={600} height={300}
              alt="Order food and drinks"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/90 rounded-full text-[10px] font-semibold text-white shadow-sm">
                🍹 FROM YOUR CHAIR
              </span>
            </div>
          </div>
          <div className="p-4 pt-3">
            <h2 className="text-[16px] font-bold tracking-tight mb-1">Order & pay with a tap</h2>
            <p className="text-[13px] text-gray-500 leading-relaxed">
              Drinks, snacks, beach gear — order anything straight to your sunbed and pay online. No waving down waiters.
            </p>
          </div>
        </div>

      </section>

      {/* Trust bar */}
      <section className="px-5 md:px-8 pt-8 md:pt-16 pb-2 max-w-md md:max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-5 md:gap-12 text-center">
          {[
            { value: '100+', label: 'Beaches' },
            { value: '10k+', label: 'Bookings' },
            { value: '4.8★', label: 'Rating' },
          ].map((stat) => (
            <div key={stat.label} className="flex-1">
              <p className="text-lg md:text-2xl font-bold text-gray-800">{stat.value}</p>
              <p className="text-[11px] md:text-sm text-gray-400 font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-8 pt-6 md:pt-14 pb-10 md:pb-16 max-w-3xl mx-auto">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 md:p-10 lg:p-14 text-center shadow-card">
          <p className="text-lg md:text-2xl lg:text-3xl font-bold text-white leading-snug mb-1.5 md:mb-3">
            Your beach day,
            <br />
            simplified.
          </p>
          <p className="text-[13px] md:text-base text-gray-400 mb-5 md:mb-8">
            No app download needed. Works in your browser.
          </p>
          <div className="flex flex-col md:flex-row md:justify-center gap-2.5 md:gap-4">
            <button
              onClick={() => router.push('/sites')}
              className="w-full md:w-auto md:px-8 py-2.5 md:py-3 text-sm font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-50 shadow-soft"
            >
              Explore beaches
            </button>
            <button
              onClick={() => signIn('google')}
              className="w-full md:w-auto md:px-8 py-2.5 md:py-3 text-sm font-medium text-gray-400 bg-white/10 rounded-xl hover:bg-white/15 border border-white/10"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <section className="pb-8 md:pb-12 text-center">
        <p className="text-[11px] md:text-sm text-gray-400">
          © {new Date().getFullYear()} Sunbnb · <a href="/tos" className="underline hover:text-gray-600">Terms</a> · <a href="/privacy" className="underline hover:text-gray-600">Privacy</a>
        </p>
      </section>
    </div>
  )
}
