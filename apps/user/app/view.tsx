'use client'

import Image from 'next/image'
import SearchBar from '@/components/search/search-bar'
import sunbnbHorizontalBlack from './sunbnb-horizontal-black.png'

export default function HomeView() {
  return (
    <div className="bg-[#fff5e1] font-sans text-[#2d2d2d]">
      <section className="h-[250px] flex flex-col items-center justify-center text-center px-4 bg-[#fff5e1]">
        <Image src={sunbnbHorizontalBlack} alt="Sunbnb logo"/>
      </section>
      <section className="-mt-[40px] flex flex-col items-center justify-center text-center px-4 bg-[#fff5e1]">
        <div className="rounded-lg p-2 w-full">
          <h1 className="text-[34px] font-semibold mb-3" style={{ lineHeight: '36px' }}>Reserve Your Spot on the Beach</h1>
          <p className="text-[18px] mb-4">
            Plan ahead or book instantly on the beach. All from one app.
          </p>
          <div className="w-full">
            <SearchBar />
          </div>
        </div>
      </section>

      {/* Use Case 1: Book Before You Go */}
      <section className="flex flex-col md:flex-row items-center gap-6 px-5 py-12 bg-white max-w-4xl mx-auto mt-[60px]">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-yellow-600">
          <div className="bg-yellow-50 w-full h-40 rounded-md border border-yellow-200 flex items-center justify-center text-sm text-yellow-700">
            Beach search interface preview
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left">
          <h2 className="text-xl font-semibold mb-2">🔍 Book Before You Go</h2>
          <p className="text-sm leading-relaxed">
            Search your beach, select a sunbed, and book it before you arrive. No stress, no surprises.
          </p>
        </div>
      </section>

      {/* Use Case 2: Use Map or QR */}
      <section className="flex flex-col md:flex-row-reverse items-center gap-6 px-5 py-12 bg-[#fdf8ea] max-w-4xl mx-auto">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-blue-600">
          <div className="bg-blue-50 w-full h-40 rounded-md border border-blue-200 flex items-center justify-center text-sm text-blue-700">
            Interactive chair map / QR scan mockup
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left">
          <h2 className="text-xl font-semibold mb-2">🪑 Book on the Beach</h2>
          <p className="text-sm leading-relaxed">
            Use the live map to pick a sunbed — or scan a QR code to instantly claim one, just like tossing down a towel.
          </p>
        </div>
      </section>

      {/* Use Case 3: Order & Pay */}
      <section className="flex flex-col md:flex-row items-center gap-6 px-5 py-12 bg-white max-w-4xl mx-auto">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-green-600">
          <div className="bg-green-50 w-full h-40 rounded-md border border-green-200 flex items-center justify-center text-sm text-green-700">
            Food & drink menu + payment preview
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left">
          <h2 className="text-xl font-semibold mb-2">🍹 Order & Pay with a Tap</h2>
          <p className="text-sm leading-relaxed">
            Order drinks, food, or rentals right to your chair — and pay online with just a few clicks.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-10 text-center bg-[#fff3d2]">
        <h2 className="text-lg font-semibold mb-3">Your beach day, simplified.</h2>
        <button className="bg-yellow-500 text-white px-5 py-2 rounded-md text-sm hover:bg-yellow-600">
          Explore Beaches
        </button>
      </section>
    </div>
  )
}
