'use client'

import { useState, FormEvent } from 'react'

interface CredentialsFormProps {
  onSubmit: (email: string, password: string) => Promise<void>
  /** Visual theme */
  theme?: 'light' | 'dark'
  /** Custom focus ring/border color class for inputs (e.g. 'focus:ring-brand-cyan/30 focus:border-brand-cyan') */
  inputFocusClassName?: string
  /** Custom button color class (e.g. 'bg-brand-cyan hover:bg-brand-cyan-dark') */
  buttonClassName?: string
  className?: string
}

export function CredentialsForm({ onSubmit, theme = 'light', inputFocusClassName, buttonClassName: customButtonClassName, className }: CredentialsFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isDark = theme === 'dark'

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
    ? 'w-full px-3.5 py-2.5 text-sm bg-gray-900 border border-gray-700 rounded-xl focus:outline-none focus:ring-2 transition-all placeholder:text-gray-600 text-gray-200'
    : 'w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 transition-all placeholder:text-gray-300 text-gray-900'
  const inputClass = `${inputBase} ${focusClasses}`

  const labelClass = isDark
    ? 'block text-xs font-medium text-gray-400 mb-1.5'
    : 'block text-xs font-medium text-gray-600 mb-1.5'

  const defaultButtonClass = isDark
    ? 'w-full py-2.5 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-500 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
    : 'w-full py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
  const buttonClass = customButtonClassName || defaultButtonClass

  return (
    <form onSubmit={handleSubmit} className={`space-y-3 ${className || ''}`}>
      <div>
        <label htmlFor="signin-email" className={labelClass}>Email</label>
        <input
          id="signin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="signin-password" className={labelClass}>Password</label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          className={inputClass}
        />
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
