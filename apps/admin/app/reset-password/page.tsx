'use client'

import { useState, FormEvent, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import sunbnbLogo from '@/app/sunbnb-logo.svg'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (data.ok) {
        setSuccess(true)
      } else {
        setError(data.error || 'Something went wrong')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">Invalid reset link</h2>
        <p className="mt-2 text-sm text-gray-400">This link is missing or malformed.</p>
        <Link href="/forgot-password" className="inline-block mt-6 text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors">
          Request a new link
        </Link>
      </div>
    )
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Password updated</h2>
        <p className="mt-2 text-sm text-gray-400">Your password has been reset successfully.</p>
        <Link href="/sign-in" className="inline-block mt-6 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-500 px-6 py-2.5 transition-colors shadow-sm">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white tracking-tight">Set new password</h2>
        <p className="mt-1.5 text-sm text-gray-500">Choose a new password for your account.</p>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-3">
        <div>
          <label htmlFor="new-password" className="block text-xs font-medium text-gray-400 mb-1.5">New password</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={6}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400 transition-all placeholder:text-gray-600 text-gray-200"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-400 mb-1.5">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={6}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400 transition-all placeholder:text-gray-600 text-gray-200"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-500 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Resetting…
            </span>
          ) : (
            'Reset password'
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/sign-in" className="text-sm text-gray-500 hover:text-gray-400 transition-colors">
          Back to sign in
        </Link>
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center mb-10">
          <Image alt="Sunbnb" src={sunbnbLogo} className="w-7 h-7 brightness-200" />
          <span className="text-sm font-bold text-gray-300 tracking-wide">
            sunbnb <span className="text-purple-400">admin</span>
          </span>
        </div>
        <Suspense fallback={
          <div className="flex justify-center">
            <div className="w-5 h-5 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
          </div>
        }>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  )
}
