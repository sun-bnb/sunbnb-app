'use client'

import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { SignInLayout, OAuthButton, CredentialsForm, SignInError, SignInDivider } from '@repo/ui/sign-in'
import sunbnbLogo from '@/app/sunbnb-logo.svg'

function PartnerBrandingPanel() {
  return (
    <div className="flex-1 min-w-0 bg-gray-900 relative overflow-hidden flex flex-col justify-between p-12">
      {/* Decorative elements */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 -left-16 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-cyan-400/8 rounded-full blur-2xl" />

      <div className="relative">
        <div className="flex items-center gap-2.5">
          <Image alt="Sunbnb" src={sunbnbLogo} className="w-9 h-9 brightness-0 invert" />
          <div>
            <span className="text-lg font-bold text-white">sunbnb</span>
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider ml-1.5">Partner</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight tracking-tight">
          Manage your
          <br />
          beach business,
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
            effortlessly.
          </span>
        </h1>
        <p className="mt-5 text-gray-400 text-lg leading-relaxed max-w-md">
          Real-time bookings, interactive site maps, and automated payments — all in one place.
        </p>
      </div>

      <div className="relative flex items-center gap-8 text-sm">
        <div>
          <p className="text-2xl font-bold text-white">100+</p>
          <p className="text-gray-500 text-xs">Beach venues</p>
        </div>
        <div className="w-px h-8 bg-gray-700" />
        <div>
          <p className="text-2xl font-bold text-white">10k+</p>
          <p className="text-gray-500 text-xs">Reservations</p>
        </div>
        <div className="w-px h-8 bg-gray-700" />
        <div>
          <p className="text-2xl font-bold text-white">99.9%</p>
          <p className="text-gray-500 text-xs">Uptime</p>
        </div>
      </div>
    </div>
  )
}

function SignInContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const errorParam = searchParams.get('error')

  const handleCredentialsSignIn = async (email: string, password: string) => {
    await signIn('credentials', { email, password, callbackUrl, redirect: true })
  }

  return (
    <SignInLayout theme="light" left={<PartnerBrandingPanel />}>
      {/* Mobile logo */}
      <div className="flex items-center gap-2 mb-10 lg:hidden">
        <Image alt="Sunbnb" src={sunbnbLogo} className="w-8 h-8" />
        <span className="text-sm font-bold text-gray-900">sunbnb</span>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider ml-1">Partner</span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back</h2>
        <p className="mt-1.5 text-sm text-gray-500">Sign in to your partner account to continue.</p>
      </div>

      <SignInError errorCode={errorParam} theme="light" className="mt-5" />

      {/* OAuth providers */}
      <div className="mt-8 space-y-3">
        <OAuthButton provider="google" onClick={() => signIn('google', { callbackUrl })} />
        <OAuthButton provider="facebook" onClick={() => signIn('facebook', { callbackUrl })} />
      </div>

      <div className="mt-6">
        <SignInDivider theme="light" />
      </div>

      <div className="mt-6">
        <CredentialsForm onSubmit={handleCredentialsSignIn} theme="light" />
      </div>

      <p className="mt-2 text-xs text-gray-400 text-center">
        Don&apos;t have an account? Just enter your email and password to create one.
      </p>

      <p className="mt-8 text-[11px] text-gray-400 text-center leading-relaxed">
        By signing in, you agree to our{' '}
        <a href="/tos" className="underline hover:text-gray-600 transition-colors">Terms of Service</a>
        {' '}and{' '}
        <a href="/privacy" className="underline hover:text-gray-600 transition-colors">Privacy Policy</a>.
      </p>

      <div className="mt-10 pt-6 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-400">
          Want to book a sunbed instead?{' '}
          <a href="https://sunbnb.app" className="text-blue-600 hover:text-blue-700 font-medium transition-colors">
            Visit sunbnb.app
          </a>
        </p>
      </div>
    </SignInLayout>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  )
}
