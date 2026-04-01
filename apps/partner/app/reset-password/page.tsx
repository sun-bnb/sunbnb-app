'use client'

import { useState, useEffect, useRef, FormEvent, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import sunbnbLogo from '@/app/sunbnb-logo.svg'

// ─── Validation helpers ───────────────────────────────────────────────────────

interface PasswordChecks {
  length: boolean
  lowercase: boolean
  uppercase: boolean
  digit: boolean
}

function checkPassword(value: string): PasswordChecks {
  return {
    length: value.length >= 8,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    digit: /[0-9]/.test(value),
  }
}

function isPasswordValid(checks: PasswordChecks) {
  return checks.length && checks.lowercase && checks.uppercase && checks.digit
}

type ValidationState = 'idle' | 'valid' | 'invalid'

function useDebouncedState(value: string, validate: (v: string) => boolean, delayMs = 500): ValidationState {
  const [state, setState] = useState<ValidationState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!value) { setState('idle'); return }
    clearTimeout(timer.current)
    if (validate(value)) { setState('valid'); return }
    timer.current = setTimeout(() => setState(validate(value) ? 'valid' : 'invalid'), delayMs)
    return () => clearTimeout(timer.current)
  }, [value, validate, delayMs])

  return state
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function ValidationDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 transition-colors duration-200 ${ok ? 'text-emerald-500' : 'text-gray-400'}`}>
      {ok ? <CheckIcon /> : <span className="w-[14px] text-center text-[10px]">&#9679;</span>}
      <span className="text-[11px]">{label}</span>
    </span>
  )
}

const INPUT_CLASS = 'w-full px-3.5 py-2.5 text-sm bg-white border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400/30 transition-all placeholder:text-gray-300 text-gray-900 pr-9'

function inputBorder(state: ValidationState) {
  if (state === 'valid') return 'border-emerald-400/60 focus:border-emerald-400'
  if (state === 'invalid') return 'border-red-300 focus:border-red-400'
  return 'border-gray-200 focus:border-blue-400'
}

// ─── Component ────────────────────────────────────────────────────────────────

function ResetPasswordContent() {
  const t = useTranslations('ResetPassword')
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const pwChecks = checkPassword(password)
  const pwState = useDebouncedState(password, (v) => isPasswordValid(checkPassword(v)))
  const confirmState = useDebouncedState(confirmPassword, (v) => !!v && v === password)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isPasswordValid(pwChecks)) {
      setError(t('errorWeakPassword'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'))
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
        setError(data.error || t('errorGeneral'))
      }
    } catch {
      setError(t('errorGeneral'))
    } finally {
      setIsLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">{t('invalidLinkTitle')}</h2>
        <p className="mt-2 text-sm text-gray-500">{t('invalidLinkBody')}</p>
        <Link href="/forgot-password" className="inline-block mt-6 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
          {t('requestNewLink')}
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
        <h2 className="text-xl font-bold text-gray-900">{t('successTitle')}</h2>
        <p className="mt-2 text-sm text-gray-500">{t('successBody')}</p>
        <Link href="/sign-in" className="inline-block mt-6 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 px-6 py-2.5 transition-colors shadow-sm">
          {t('signIn')}
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">{t('title')}</h2>
        <p className="mt-1.5 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-3">
        {/* New password */}
        <div>
          <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 mb-1.5">{t('newPassword')}</label>
          <div className="relative">
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              className={`${INPUT_CLASS} ${inputBorder(pwState)}`}
            />
            {pwState !== 'idle' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                {pwState === 'valid' ? <span className="text-emerald-500"><CheckIcon /></span> : <span className="text-red-400"><XIcon /></span>}
              </span>
            )}
          </div>
          {password.length > 0 && pwState !== 'valid' && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              <ValidationDot ok={pwChecks.length} label={t('validationChars')} />
              <ValidationDot ok={pwChecks.uppercase} label={t('validationUpper')} />
              <ValidationDot ok={pwChecks.lowercase} label={t('validationLower')} />
              <ValidationDot ok={pwChecks.digit} label={t('validationDigit')} />
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div>
          <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 mb-1.5">{t('confirmPassword')}</label>
          <div className="relative">
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              className={`${INPUT_CLASS} ${inputBorder(confirmState)}`}
            />
            {confirmState !== 'idle' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                {confirmState === 'valid' ? <span className="text-emerald-500"><CheckIcon /></span> : <span className="text-red-400"><XIcon /></span>}
              </span>
            )}
          </div>
          {confirmState === 'invalid' && (
            <p className="mt-1 text-[11px] text-red-500">{t('passwordsDoNotMatch')}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t('resetting')}
            </span>
          ) : (
            t('resetPassword')
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/sign-in" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          {t('backToSignIn')}
        </Link>
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-10">
          <Image alt="Sunbnb" src={sunbnbLogo} className="w-8 h-8" />
          <span className="text-sm font-bold text-gray-900">sunbnb</span>
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider ml-1">Partner</span>
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
