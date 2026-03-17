'use client'

import { useState, useEffect, useRef, FormEvent } from 'react'

interface CredentialsFormProps {
  onSubmit: (email: string, password: string) => Promise<void>
  /** Visual theme */
  theme?: 'light' | 'dark'
  /** Custom focus ring/border color class for inputs (e.g. 'focus:ring-brand-cyan/30 focus:border-brand-cyan') */
  inputFocusClassName?: string
  /** Custom button color class (e.g. 'bg-brand-cyan hover:bg-brand-cyan-dark') */
  buttonClassName?: string
  /** Href for "Forgot password?" link (defaults to /forgot-password) */
  forgotPasswordHref?: string
  className?: string
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ValidationState = 'idle' | 'valid' | 'invalid'

interface PasswordChecks {
  length: boolean
  lowercase: boolean
  uppercase: boolean
  digit: boolean
}

function validateEmail(value: string): ValidationState {
  if (!value) return 'idle'
  return EMAIL_RE.test(value) ? 'valid' : 'invalid'
}

function checkPassword(value: string): PasswordChecks {
  return {
    length: value.length >= 8,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    digit: /[0-9]/.test(value),
  }
}

function passwordState(checks: PasswordChecks): ValidationState {
  return checks.length && checks.lowercase && checks.uppercase && checks.digit
    ? 'valid'
    : 'invalid'
}

// ─── Debounce hook ────────────────────────────────────────────────────────────

function useDebouncedValidation<T>(
  value: T,
  validate: (v: T) => ValidationState,
  delayMs = 500,
): ValidationState {
  const [state, setState] = useState<ValidationState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const touched = useRef(false)

  useEffect(() => {
    // Never show validation for empty fields
    if (typeof value === 'string' && !value) {
      setState('idle')
      touched.current = false
      return
    }

    touched.current = true

    // Immediately clear previous debounce
    clearTimeout(timer.current)

    // If already valid, update immediately (responsive "green" feedback)
    const result = validate(value)
    if (result === 'valid') {
      setState('valid')
      return
    }

    // Debounce invalid state so we don't flash red while typing
    timer.current = setTimeout(() => {
      setState(validate(value))
    }, delayMs)

    return () => clearTimeout(timer.current)
  }, [value, validate, delayMs])

  return state
}

// ─── Indicator icons ──────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function ValidationDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 transition-colors duration-200 ${ok ? 'text-emerald-500' : 'text-gray-400'}`}>
      {ok ? <CheckIcon className="text-emerald-500" /> : <span className="w-[14px] text-center text-[10px]">&#9679;</span>}
      <span className="text-[11px]">{label}</span>
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CredentialsForm({ onSubmit, theme = 'light', inputFocusClassName, buttonClassName: customButtonClassName, forgotPasswordHref = '/forgot-password', className }: CredentialsFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isDark = theme === 'dark'

  // Debounced validation
  const emailState = useDebouncedValidation(email, validateEmail, 500)
  const pwChecks = checkPassword(password)
  const pwState = useDebouncedValidation(password, (v) => passwordState(checkPassword(v)), 500)

  // Show password hints once the user has typed something
  const showPasswordHints = password.length > 0

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setIsLoading(true)
    try {
      await onSubmit(email, password)
    } catch {
      setIsLoading(false)
    }
  }

  const defaultInputFocus = isDark
    ? 'focus:ring-purple-400/30 focus:border-purple-400'
    : 'focus:ring-blue-400/30 focus:border-blue-400'
  const focusClasses = inputFocusClassName || defaultInputFocus

  const inputBase = isDark
    ? 'w-full px-3.5 py-2.5 text-sm bg-gray-900 border rounded-xl focus:outline-none focus:ring-2 transition-all placeholder:text-gray-600 text-gray-200'
    : 'w-full px-3.5 py-2.5 text-sm bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all placeholder:text-gray-300 text-gray-900'

  const defaultBorder = isDark ? 'border-gray-700' : 'border-gray-200'
  const validBorder = isDark ? 'border-emerald-500/50' : 'border-emerald-400/60'
  const invalidBorder = isDark ? 'border-red-500/50' : 'border-red-300'

  function borderClass(state: ValidationState) {
    if (state === 'valid') return validBorder
    if (state === 'invalid') return invalidBorder
    return defaultBorder
  }

  const labelClass = isDark
    ? 'block text-xs font-medium text-gray-400 mb-1.5'
    : 'block text-xs font-medium text-gray-600 mb-1.5'

  const defaultButtonClass = isDark
    ? 'w-full py-2.5 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-500 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
    : 'w-full py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
  const buttonClass = customButtonClassName || defaultButtonClass

  return (
    <form onSubmit={handleSubmit} className={`space-y-3 ${className || ''}`}>
      {/* Email field */}
      <div>
        <label htmlFor="signin-email" className={labelClass}>Email</label>
        <div className="relative">
          <input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className={`${inputBase} ${borderClass(emailState)} ${focusClasses} pr-9`}
          />
          {emailState !== 'idle' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {emailState === 'valid'
                ? <CheckIcon className="text-emerald-500" />
                : <XIcon className="text-red-400" />
              }
            </span>
          )}
        </div>
        {emailState === 'invalid' && (
          <p className={`mt-1 text-[11px] transition-all duration-200 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
            Enter a valid email address
          </p>
        )}
      </div>

      {/* Password field */}
      <div>
        <label htmlFor="signin-password" className={labelClass}>Password</label>
        <div className="relative">
          <input
            id="signin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            minLength={8}
            className={`${inputBase} ${borderClass(pwState)} ${focusClasses} pr-9`}
          />
          {pwState !== 'idle' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {pwState === 'valid'
                ? <CheckIcon className="text-emerald-500" />
                : <XIcon className="text-red-400" />
              }
            </span>
          )}
        </div>
        {showPasswordHints && pwState !== 'valid' && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <ValidationDot ok={pwChecks.length} label="8+ chars" />
            <ValidationDot ok={pwChecks.uppercase} label="A-Z" />
            <ValidationDot ok={pwChecks.lowercase} label="a-z" />
            <ValidationDot ok={pwChecks.digit} label="0-9" />
          </div>
        )}
        <div className="mt-1.5 text-right">
          <a href={forgotPasswordHref} className={`text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>
            Forgot password?
          </a>
        </div>
      </div>
      <button type="submit" disabled={isLoading} className={buttonClass}>
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Signing in…
          </span>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  )
}
