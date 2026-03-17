'use client'

import { useState, FormEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import sunbnbLogo from '@/app/sunbnb-horizontal-black.png'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const t = useTranslations('ForgotPassword')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (data.ok) {
        setSubmitted(true)
      } else {
        setError(data.error || t('Something went wrong'))
      }
    } catch {
      setError(t('Something went wrong. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-10">
          <Image src={sunbnbLogo} alt="Sunbnb" className="w-[140px]" />
        </div>

        {submitted ? (
          <div className="text-center">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{t('Check your inbox')}</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {t('If an account exists we\'ve sent a reset link. It expires in 1 hour.')}
            </p>
            <Link href="/sign-in" className="inline-block mt-6 text-sm text-brand-cyan hover:text-brand-cyan-dark font-medium transition-colors">
              {t('Back to sign in')}
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">{t('Forgot your password')}</h2>
              <p className="mt-1.5 text-sm text-gray-500">{t('Enter your email and we\'ll send you a reset link')}</p>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-3">
              <div>
                <label htmlFor="reset-email" className="block text-xs font-medium text-gray-600 mb-1.5">{t('Email')}</label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('you@example.com')}
                  autoComplete="email"
                  required
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
                    {t('Sending')}
                  </span>
                ) : (
                  t('Send reset link')
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link href="/sign-in" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                {t('Back to sign in')}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
