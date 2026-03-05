'use client'

import Image from 'next/image'
import SearchBar from '@/components/search/search-bar'
import sunbnbHorizontalBlack from './sunbnb-horizontal-black.png'
import reservationScreen from './reservation-screen.png'
import { useRouter } from 'next/navigation'

export default function HomeView() {

  const router = useRouter()

  return (
    <div className="bg-cream font-sans text-[#2d2d2d]">
      <section className="h-[220px] flex flex-col items-center justify-center text-center px-4 bg-cream">
        <Image src={sunbnbHorizontalBlack} alt="Sunbnb logo"/>
      </section>
      <section className="-mt-[32px] flex flex-col items-center justify-center text-center px-6 bg-cream">
        <div className="rounded-lg p-2 w-full">
          <h1 className="text-[32px] font-semibold mb-3 leading-[38px] tracking-tight">Reserve Your Spot on the Beach</h1>
          <p className="text-[17px] text-gray-600 mb-5 leading-relaxed">
            Plan ahead or book instantly on the beach. All from one app.
          </p>
          <div className="w-full">
            <SearchBar />
          </div>
          {
            false &&
              <div className="mt-[35px]">
                <button onClick={() => {
                  router.push('/api/auth/signin')
                }} className="bg-yellow-500 text-white px-5 py-2 rounded-md text-md hover:bg-yellow-600">
                  <b>REGISTER AND BOOK NOW!</b>
                </button>
              </div>
          }
        </div>
      </section>

      {/* Use Case 1: Book Before You Go */}
      <section className="flex flex-col md:flex-row items-center gap-6 bg-white pb-14 max-w-4xl mx-auto mt-10 rounded-t-2xl">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-yellow-600">
          <div className="w-full h-40 flex items-center justify-center text-sm text-yellow-700">
            <Image 
              src={reservationScreen}
              width={400} height={200}
              alt="Reservation screen mockup" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left px-6">
          <h2 className="text-lg font-semibold mb-2 tracking-tight">🔍 Book Before You Go</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Search your beach, select a sunbed, and book it before you arrive. No stress, no surprises.
          </p>
        </div>
        <div className="px-6 pb-2 md:pb-0">
          <button onClick={() => {
            router.push('/sites')
          }} className="bg-yellow-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-yellow-600 shadow-soft hover:shadow-card">
            Explore Beaches
          </button>
        </div>
      </section>

      {/* Use Case 2: Use Map or QR */}
      <section className="flex flex-col md:flex-row-reverse items-center gap-6 pb-14 max-w-4xl mx-auto bg-white">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-blue-600">
          <div className="bg-blue-50 w-full h-40 flex items-center justify-center text-sm text-blue-700">
            <Image 
              src="https://9vo2eopfbefycklx.public.blob.vercel-storage.com/public/front-page-section2-w34RgcJ5VOCKDUcshhbDlEjHghfATC.png"
              width={400} height={200}
              alt="Reservation screen mockup" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left px-6">
          <h2 className="text-lg font-semibold mb-2 tracking-tight">⛱️ Book on the Beach</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Use the live map to pick a sunbed — or scan a QR code to instantly claim one, just like tossing down a towel.
          </p>
        </div>
      </section>

      {/* Use Case 3: Order & Pay */}
      <section className="flex flex-col md:flex-row items-center gap-6 pb-14 bg-white max-w-4xl mx-auto rounded-b-2xl">
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center text-green-600">
          <div className="w-full h-40 flex items-center justify-center text-sm text-green-700">
          <Image 
              src="https://9vo2eopfbefycklx.public.blob.vercel-storage.com/public/front-page-section3-VXCLoOVCvTAIrMSAqkwt9Y5U720RKD.png"
              width={400} height={200}
              alt="Reservation screen mockup" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="md:w-1/2 text-center md:text-left px-6">
          <h2 className="text-lg font-semibold mb-2 tracking-tight">🍹 Order & Pay with a Tap</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Order drinks, food, or rentals right to your chair — and pay online with just a few clicks.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pt-20 pb-20 text-center bg-cream-dark">
        <h2 className="text-lg font-semibold mb-4 tracking-tight">Your beach day, simplified.</h2>
        <button onClick={() => {
          router.push('/sites')
        }} className="bg-yellow-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-yellow-600 shadow-soft hover:shadow-card">
          Explore Beaches
        </button>
      </section>
    </div>
  )
}
