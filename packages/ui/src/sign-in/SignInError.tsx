'use client'

interface SignInErrorProps {
  /** Error code from the URL search params */
  errorCode: string | null
  /** Map of error codes to user-friendly messages */
  errorMessages?: Record<string, string>
  /** Visual theme */
  theme?: 'light' | 'dark'
  className?: string
}

const defaultMessages: Record<string, string> = {
  OAuthAccountNotLinked: 'This email is already associated with another sign-in method.',
  CredentialsSignin: 'Invalid email or password. Please try again.',
  TooManyAttempts: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  WeakPassword: 'Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
  AccessDenied: 'Access denied. Please contact support.',
  Default: 'Something went wrong. Please try again.',
}

export function SignInError({
  errorCode,
  errorMessages,
  theme = 'light',
  className,
}: SignInErrorProps) {
  if (!errorCode) return null

  const messages = { ...defaultMessages, ...errorMessages }
  const message = messages[errorCode] || messages.Default

  const isDark = theme === 'dark'

  if (isDark) {
    return (
      <div className={`px-3 py-2.5 border border-red-500/30 bg-red-500/5 rounded-md ${className || ''}`}>
        <p className="text-xs text-red-400 font-mono">{message}</p>
        <p className="text-[10px] text-gray-600 mt-1 font-mono">code: {errorCode}</p>
      </div>
    )
  }

  return (
    <div className={`px-4 py-3 bg-red-50 border border-red-100 rounded-xl ${className || ''}`}>
      <p className="text-sm text-red-600 font-medium">{message}</p>
    </div>
  )
}
