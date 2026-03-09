'use client'

import { useState, FormEvent, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import sunbnbLogo from '@/app/sunbnb-horizontal-black.png'

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
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain uppercase, lowercase, and a number')
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
        <h2 className="text-xl font-bold text-gray-900">Invalid reset link</h2>
        <p className="mt-2 text-sm text-gray-500">This link is missing or malformed.</p>
        <Link href="/forgot-password" className="inline-block mt-6 text-sm text-brand-cyan hover:text-brand-cyan-dark font-medium transition-colors">
          Request a new link
        </Link>
      </div>
    )
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Password updated</h2>
        <p className="mt-2 text-sm text-gray-500">Your password has been reset successfully.</p>
        <Link href="/sign-in" className="inline-block mt-6 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 px-6 py-2.5 transition-colors shadow-sm">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Set new password</h2>
        <p className="mt-1.5 text-sm text-gray-500">Choose a new password for your account.</p>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-3">
        <div>
          <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 mb-1.5">New password</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan transition-all placeholder:text-gray-300 text-gray-900"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 mb-1.5">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan transition-all placeholder:text-gray-300 text-gray-900"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
        <Link href="/sign-in" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Back to sign in
        </Link>
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-10">
          <Image src={sunbnbLogo} alt="Sunbnb" className="w-[140px]" />
        </div>
        <Suspense fallback={
          <div className="flex justify-center">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          </div>
        }>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  )
}
