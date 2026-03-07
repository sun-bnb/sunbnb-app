'use client'

import Image from 'next/image'
import SearchBar from '@/components/search/search-bar'
import sunbnbHorizontalBlack from './sunbnb-horizontal-black.png'
import reservationScreen from './reservation-screen.png'
import scanQrImage from './scan-qr-image.png'
import beachProducts from './beach-products.png'
import { useRouter } from 'next/navigation'

export default function HomeView() {

  const router = useRouter()

  return (
    <div className="bg-cream font-sans text-[#2d2d2d] pt-14 overflow-x-hidden">

      {/* ─── Hero ─── */}
      <section className="relative px-5 md:px-8 pt-12 md:pt-24 lg:pt-32 pb-10 md:pb-20 max-w-6xl mx-auto">
        {/* Ambient background */}
        <div className="absolute -top-20 -right-24 w-64 h-64 md:w-[420px] md:h-[420px] bg-gradient-to-br from-brand-cyan/12 to-cyan-300/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 -left-28 w-52 h-52 md:w-80 md:h-80 bg-gradient-to-tr from-amber-200/15 to-yellow-300/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-40 bg-gradient-to-t from-brand-cyan/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:gap-16">
          {/* Left column — text + search */}
          <div className="lg:flex-1 text-center lg:text-left">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/70 backdrop-blur-sm rounded-full border border-white/80 shadow-soft mb-5 md:mb-7 animate-fade-in">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-[11px] md:text-xs font-medium text-gray-500 tracking-wide">Live availability across 100+ beaches</span>
            </div>

            <h1 className="text-[32px] md:text-5xl lg:text-[56px] font-extrabold leading-[1.1] tracking-tight mb-4 md:mb-5 animate-fade-in-up">
              Your place
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan via-cyan-400 to-brand-cyan animate-shimmer">
                under the sun
              </span>
            </h1>

            <p className="text-[15px] md:text-lg lg:text-xl text-gray-500 leading-relaxed mb-7 md:mb-9 max-w-[320px] md:max-w-lg mx-auto lg:mx-0 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
              Find a beach, pick your sunbed, and book in seconds.
              <br className="hidden md:block" />
              No app download needed.
            </p>

            <div className="relative z-10 w-full max-w-md mx-auto lg:mx-0 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
              <SearchBar />
              <p className="mt-3 text-[11px] md:text-xs text-gray-400">
                Try <button onClick={() => router.push('/sites')} className="text-brand-cyan hover:text-brand-cyan-dark font-medium underline underline-offset-2">browsing all beaches</button> or search by destination
              </p>
            </div>
          </div>

          {/* Right column — hero visual */}
          <div className="hidden lg:block lg:flex-1 relative animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <div className="relative w-full max-w-[420px] mx-auto">
              {/* Phone frame */}
              <div className="relative rounded-[28px] bg-white shadow-card border border-gray-100 p-2 overflow-hidden animate-float">
                <Image
                  src={reservationScreen}
                  width={600}
                  height={400}
                  alt="Sunbnb reservation screen"
                  className="rounded-[20px] w-full"
                />
              </div>
              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-6 bg-white rounded-2xl px-4 py-3 shadow-card border border-gray-100 animate-bubble-up" style={{ animationDelay: '0.6s' }}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">⛱️</span>
                  <div>
                    <p className="text-xs font-bold text-gray-800">Sunbed #12</p>
                    <p className="text-[10px] text-emerald-500 font-medium">Booked — enjoy!</p>
                  </div>
                </div>
              </div>
              {/* Floating rating */}
              <div className="absolute -top-3 -right-4 bg-white rounded-xl px-3 py-2 shadow-card border border-gray-100 animate-bubble-up" style={{ animationDelay: '0.8s' }}>
                <p className="text-xs font-bold text-gray-800">4.8 <span className="text-amber-400">★★★★★</span></p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="px-5 md:px-8 pt-4 md:pt-8 pb-2 max-w-4xl mx-auto">
        <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.2em] text-gray-400 mb-5 md:mb-8 text-center">How it works</p>
        <div className="flex gap-3 md:gap-6">
          {[
            { step: '1', emoji: '🔍', title: 'Find a beach', desc: 'Browse by location or search your destination' },
            { step: '2', emoji: '⛱️', title: 'Pick a sunbed', desc: 'Choose from the live map with real-time availability' },
            { step: '3', emoji: '✅', title: 'Book & enjoy', desc: 'Confirm in seconds — your spot is guaranteed' },
          ].map((s, i) => (
            <div
              key={s.step}
              className="flex-1 bg-white rounded-2xl p-4 md:p-6 text-center border border-white/80 shadow-soft hover:shadow-card transition-shadow duration-300 animate-bubble-up"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div className="w-10 h-10 md:w-12 md:h-12 bg-cream-dark rounded-xl flex items-center justify-center mx-auto mb-2.5 md:mb-3">
                <span className="text-xl md:text-2xl">{s.emoji}</span>
              </div>
              <p className="text-[13px] md:text-[15px] font-bold text-gray-800 mb-1">{s.title}</p>
              <p className="text-[11px] md:text-xs text-gray-400 leading-relaxed hidden md:block">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Feature Showcase ─── */}
      <section className="px-5 md:px-8 pt-10 md:pt-20 max-w-6xl mx-auto space-y-6 md:space-y-0">

        {/* Feature 1 — full-width hero card */}
        <div className="bg-white rounded-2xl md:rounded-3xl overflow-hidden shadow-card md:flex md:items-stretch">
          <div className="md:flex-1 relative h-52 md:h-auto md:min-h-[320px] overflow-hidden">
            <Image
              src={reservationScreen}
              width={800}
              height={500}
              alt="Book before you go"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-white/60 hidden md:block" />
            <div className="absolute inset-0 bg-gradient-to-t from-white/70 via-transparent to-transparent md:hidden" />
          </div>
          <div className="md:flex-1 p-6 md:p-10 lg:p-14 flex flex-col justify-center">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-cyan/10 rounded-full text-[10px] md:text-xs font-semibold text-brand-cyan w-fit mb-3 md:mb-4">
              🔍 PLAN AHEAD
            </span>
            <h2 className="text-xl md:text-2xl lg:text-3xl font-bold tracking-tight mb-2 md:mb-3">
              Book before you go
            </h2>
            <p className="text-sm md:text-base text-gray-500 leading-relaxed mb-4 md:mb-6">
              Search your destination, browse the interactive beach layout, and reserve the perfect spot — all before you leave home. No surprises when you arrive.
            </p>
            <button
              onClick={() => router.push('/sites')}
              className="w-fit px-5 py-2 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 shadow-soft transition-colors"
            >
              Browse beaches →
            </button>
          </div>
        </div>

        {/* Feature 2 + 3 side by side on desktop */}
        <div className="md:grid md:grid-cols-2 md:gap-6 md:pt-6 space-y-6 md:space-y-0">
          
          {/* Feature 2 */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lg transition-shadow duration-300">
            <div className="relative h-48 md:h-56 overflow-hidden">
              <Image
                src={scanQrImage}
                width={600}
                height={350}
                alt="Scan QR code on the beach"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
            </div>
            <div className="p-5 md:p-6">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 rounded-full text-[10px] md:text-xs font-semibold text-amber-600 w-fit mb-2.5">
                ⛱️ ON THE BEACH
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-1.5">Scan & claim your sunbed</h3>
              <p className="text-[13px] md:text-sm text-gray-500 leading-relaxed">
                Already there? Use the live map to pick a free spot, or scan the QR code right on the lounger. Instant booking, no queues.
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lg transition-shadow duration-300">
            <div className="relative h-48 md:h-56 overflow-hidden">
              <Image
                src={beachProducts}
                width={600}
                height={350}
                alt="Order food and drinks to your sunbed"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
            </div>
            <div className="p-5 md:p-6">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 rounded-full text-[10px] md:text-xs font-semibold text-emerald-600 w-fit mb-2.5">
                🍹 FROM YOUR CHAIR
              </span>
              <h3 className="text-lg md:text-xl font-bold tracking-tight mb-1.5">Order & pay with a tap</h3>
              <p className="text-[13px] md:text-sm text-gray-500 leading-relaxed">
                Drinks, snacks, beach gear — order anything straight to your sunbed and pay online. No waving down waiters.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Social Proof ─── */}
      <section className="px-5 md:px-8 pt-12 md:pt-20 max-w-4xl mx-auto">
        <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-white/80 shadow-soft p-6 md:p-10">
          <div className="flex items-center justify-center gap-6 md:gap-16 text-center">
            {[
              { value: '100+', label: 'Beaches', icon: '🏖️' },
              { value: '10k+', label: 'Bookings', icon: '📋' },
              { value: '4.8★', label: 'Rating', icon: '⭐' },
            ].map((stat, i) => (
              <div key={stat.label} className="flex-1 animate-fade-in-up" style={{ animationDelay: `${0.1 * i}s` }}>
                <span className="text-xl md:text-2xl block mb-1">{stat.icon}</span>
                <p className="text-xl md:text-3xl font-extrabold text-gray-800">{stat.value}</p>
                <p className="text-[11px] md:text-sm text-gray-400 font-medium mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Testimonial / Quote ─── */}
      <section className="px-5 md:px-8 pt-10 md:pt-16 max-w-3xl mx-auto text-center">
        <blockquote className="text-lg md:text-2xl lg:text-[28px] font-semibold text-gray-700 leading-snug tracking-tight italic">
          &ldquo;We arrived, walked to our sunbeds, and they were
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-cyan-400 not-italic"> already waiting for us.</span>&rdquo;
        </blockquote>
        <p className="mt-4 text-xs md:text-sm text-gray-400">— Happy beachgoer, Heraklion</p>
      </section>

      {/* ─── CTA ─── */}
      <section className="px-5 md:px-8 pt-10 md:pt-16 pb-10 md:pb-16 max-w-4xl mx-auto">
        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl md:rounded-3xl p-8 md:p-12 lg:p-16 text-center shadow-card overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-brand-cyan/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-cyan-400/8 rounded-full blur-2xl" />
          
          <div className="relative">
            <p className="text-xl md:text-3xl lg:text-4xl font-extrabold text-white leading-snug mb-2 md:mb-4 tracking-tight">
              Your beach day,
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-cyan-300">simplified.</span>
            </p>
            <p className="text-[13px] md:text-base text-gray-400 mb-6 md:mb-9 max-w-md mx-auto">
              Works in your browser. Book a sunbed in under 30 seconds — we timed it.
            </p>
            <div className="flex flex-col sm:flex-row sm:justify-center gap-3 md:gap-4">
              <button
                onClick={() => router.push('/sites')}
                className="w-full sm:w-auto px-8 py-3 md:py-3.5 text-sm md:text-base font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-50 shadow-soft transition-colors"
              >
                Explore beaches
              </button>
              <button
                onClick={() => router.push('/sign-in')}
                className="w-full sm:w-auto px-8 py-3 md:py-3.5 text-sm md:text-base font-medium text-gray-300 bg-white/10 rounded-xl hover:bg-white/15 border border-white/10 transition-colors"
              >
                Sign in
              </button>
            </div>
            <p className="mt-6 md:mt-8 text-[12px] md:text-sm text-gray-500">
              Own a beach business?{' '}
              <a href="https://partner.sunbnb.app" className="text-brand-cyan hover:text-cyan-300 underline underline-offset-2 font-medium transition-colors">
                Become a partner
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="pb-8 md:pb-12 pt-2 text-center">
        <Image
          src={sunbnbHorizontalBlack}
          alt="Sunbnb"
          className="mx-auto mb-3 w-[100px] md:w-[120px] opacity-30"
        />
        <p className="text-[11px] md:text-xs text-gray-400 mb-2">
          © {new Date().getFullYear()} Sunbnb · <a href="/tos" className="underline hover:text-gray-600 transition-colors">Terms</a> · <a href="/privacy" className="underline hover:text-gray-600 transition-colors">Privacy</a> · <a href="/cancellation-policy" className="underline hover:text-gray-600 transition-colors">Cancellation Policy</a> · <a href="https://partner.sunbnb.app" className="underline hover:text-gray-600 transition-colors">For partners</a>
        </p>
        <p className="text-[10px] md:text-[11px] text-gray-300">
          Operated by Refactory DX Oy · Business ID 2940957-1 · Sturenkatu 37-41 B 16, 00550 Helsinki, Finland
        </p>
      </footer>
    </div>
  )
}
