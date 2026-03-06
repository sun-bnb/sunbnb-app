'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import Image from 'next/image'
import { SignInLayout, OAuthButton, CredentialsForm, SignInError, SignInDivider } from '@repo/ui/sign-in'
import sunbnbLogo from '@/app/sunbnb-logo.svg'

type HealthData = {
  status: string
  db: { status: string; latency: string }
  records: { sites: number; users: number }
  timestamp: string
}

function AdminHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {})
  }, [])

  return (
    <div className="w-[400px] flex flex-col justify-between p-8 border-r border-gray-800 min-h-full">
      <div>
        <div className="flex items-center gap-3 mb-16">
          <Image alt="Sunbnb" src={sunbnbLogo} className="w-7 h-7 brightness-200" />
          <span className="text-sm font-bold text-gray-300 tracking-wide">
            sunbnb <span className="text-purple-400">admin</span>
          </span>
        </div>

        {health ? (
          <div className="font-mono text-xs text-gray-500 space-y-3">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${health.status === 'healthy' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className="text-gray-400">{health.status === 'healthy' ? 'All systems operational' : 'Degraded'}</span>
            </div>
            <div className="border-t border-gray-800 pt-3 space-y-1.5">
              <div className="flex justify-between">
                <span>database</span>
                <span className={health.db.status === 'connected' ? 'text-green-400' : 'text-red-400'}>{health.db.status}</span>
              </div>
              <div className="flex justify-between">
                <span>latency</span>
                <span className="text-gray-400">{health.db.latency}</span>
              </div>
              <div className="flex justify-between">
                <span>sites</span>
                <span className="text-gray-400">{health.records.sites.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>users</span>
                <span className="text-gray-400">{health.records.users.toLocaleString()}</span>
              </div>
            </div>
            <div className="border-t border-gray-800 pt-3">
              <div className="flex justify-between">
                <span>checked</span>
                <span className="text-gray-600">{new Date(health.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="font-mono text-xs text-gray-600">Loading health data...</div>
        )}
      </div>

      <p className="font-mono text-[10px] text-gray-700">
        Internal use only
      </p>
    </div>
  )
}

function SignInContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/settlements'
  const errorParam = searchParams.get('error')

  const handleCredentialsSignIn = async (email: string, password: string) => {
    await signIn('credentials', { email, password, callbackUrl, redirect: true })
  }

  return (
    <SignInLayout theme="dark" left={<AdminHealthPanel />} className="bg-gray-950 font-[var(--font-geist-sans)]">
      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-3 mb-10">
        <Image alt="Sunbnb" src={sunbnbLogo} className="w-7 h-7 brightness-200" />
        <span className="text-sm font-bold text-gray-300 tracking-wide">
          sunbnb <span className="text-purple-400">admin</span>
        </span>
      </div>

      <h1 className="text-lg font-semibold text-white tracking-tight">
        Sign in
      </h1>
      <p className="mt-1.5 text-sm text-gray-500">
        Platform administration
      </p>

      <SignInError
        errorCode={errorParam}
        theme="dark"
        errorMessages={{ AccessDenied: 'Your account is not authorized for admin access.' }}
        className="mt-5"
      />

      {/* OAuth providers */}
      <div className="mt-6 space-y-2">
        <OAuthButton provider="google" onClick={() => signIn('google', { callbackUrl })} variant="dark-compact" />
        <OAuthButton provider="facebook" onClick={() => signIn('facebook', { callbackUrl })} variant="dark-compact" />
      </div>

      <div className="mt-6">
        <SignInDivider theme="dark" />
      </div>

      <div className="mt-6">
        <CredentialsForm onSubmit={handleCredentialsSignIn} theme="dark" />
      </div>

      <p className="lg:hidden mt-8 text-center text-[10px] text-gray-700 font-mono uppercase tracking-widest">
        Internal use only
      </p>
    </SignInLayout>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-purple-400 rounded-full animate-spin" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  )
}
