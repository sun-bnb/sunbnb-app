'use client'

import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { SignInLayout, OAuthButton, CredentialsForm, SignInError, SignInDivider } from '@repo/ui/sign-in'
import sunbnbLogo from '@/app/sunbnb-horizontal-black.png'

function UserBrandingPanel() {
  return (
    <div className="flex-1 min-w-0 bg-cream-dark relative overflow-hidden flex flex-col justify-between p-12">
      {/* Decorative elements */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-cyan/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 -left-16 w-72 h-72 bg-brand-gold/8 rounded-full blur-3xl" />
      <div className="absolute top-1/3 right-1/3 w-48 h-48 bg-amber-400/8 rounded-full blur-2xl" />

      <div className="relative">
        <Image
          src={sunbnbLogo}
          alt="Sunbnb"
          className="w-[140px]"
        />
      </div>

      <div className="relative">
        <h1 className="text-4xl xl:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight">
          Your place
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-cyan-500">
            under the sun
          </span>
        </h1>
        <p className="mt-5 text-gray-500 text-lg leading-relaxed max-w-md">
          Find a beach, pick your sunbed, and book in seconds. No app download needed.
        </p>
      </div>

      <div className="relative flex items-center gap-8 text-sm">
        <div>
          <p className="text-2xl font-bold text-gray-900">100+</p>
          <p className="text-gray-400 text-xs">Beaches</p>
        </div>
        <div className="w-px h-8 bg-gray-300/40" />
        <div>
          <p className="text-2xl font-bold text-gray-900">10k+</p>
          <p className="text-gray-400 text-xs">Bookings</p>
        </div>
        <div className="w-px h-8 bg-gray-300/40" />
        <div>
          <p className="text-2xl font-bold text-gray-900">4.8★</p>
          <p className="text-gray-400 text-xs">Rating</p>
        </div>
      </div>
    </div>
  )
}

function SignInContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/sites'
  const errorParam = searchParams.get('error')

  const handleCredentialsSignIn = async (email: string, password: string) => {
    await signIn('credentials', { email, password, callbackUrl, redirect: true })
  }

  return (
    <SignInLayout theme="light" left={<UserBrandingPanel />} className="bg-cream" fallbackClassName="bg-cream">
      {/* Mobile logo */}
      <div className="flex items-center justify-center mb-10 lg:hidden">
        <Image src={sunbnbLogo} alt="Sunbnb" className="w-[140px]" />
      </div>

      <div className="text-center lg:text-left">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Sign in or create account</h2>
        <p className="mt-1.5 text-sm text-gray-500">Use your email to sign in — a new account is created automatically on first login.</p>
      </div>

      <SignInError errorCode={errorParam} theme="light" className="mt-5" />

      {/* OAuth providers */}
      <div className="mt-8 space-y-3">
        <OAuthButton provider="google" onClick={() => signIn('google', { callbackUrl })} className="bg-cream-light border-cream-dark hover:bg-cream-muted" />
        <OAuthButton provider="facebook" onClick={() => signIn('facebook', { callbackUrl })} className="bg-cream-light border-cream-dark hover:bg-cream-muted" />
      </div>

      <div className="mt-6">
        <SignInDivider theme="light" />
      </div>

      <div className="mt-6">
        <CredentialsForm
          onSubmit={handleCredentialsSignIn}
          theme="light"
          inputFocusClassName="focus:ring-brand-cyan/30 focus:border-brand-cyan"
        />
      </div>

      <p className="mt-2 text-xs text-gray-400 text-center">
        No separate registration needed — just sign in and you&apos;re all set.
      </p>

      <p className="mt-8 text-[11px] text-gray-400 text-center leading-relaxed">
        By signing in, you agree to our{' '}
        <a href="/tos" className="underline hover:text-gray-600 transition-colors">Terms of Service</a>
        {' '}and{' '}
        <a href="/privacy" className="underline hover:text-gray-600 transition-colors">Privacy Policy</a>.
      </p>

      <div className="mt-8 pt-6 border-t border-gray-200/60 text-center">
        <p className="text-xs text-gray-400">
          Own a beach business?{' '}
          <a href="https://partner.sunbnb.app" className="text-brand-cyan hover:text-brand-cyan-dark font-medium transition-colors">
            Become a partner
          </a>
        </p>
      </div>
    </SignInLayout>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  )
}
