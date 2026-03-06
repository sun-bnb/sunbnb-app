'use client'

import { ReactNode, Suspense } from 'react'

export type SignInTheme = 'light' | 'dark'

interface SignInLayoutProps {
  /** Light or dark theme for the right panel and fallback spinner */
  theme?: SignInTheme
  /** Content for the left branding panel (hidden on mobile) */
  left?: ReactNode
  /** Main sign-in content (right panel) */
  children: ReactNode
  /** Additional className for the outer container */
  className?: string
  /** Fallback spinner bg class (auto-detected from theme if not set) */
  fallbackClassName?: string
}

function SignInLayoutInner({ theme = 'light', left, children, className }: SignInLayoutProps) {
  const isDark = theme === 'dark'
  const defaultBg = className ? '' : (isDark ? 'bg-gray-950' : 'bg-gray-50')
  return (
    <div className={`min-h-screen flex ${defaultBg} ${className || ''}`}>
      {/* Left panel — branding (desktop only) */}
      {left && (
        <div className="hidden lg:flex flex-col self-stretch">
          {left}
        </div>
      )}

      {/* Right panel — sign-in form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full">
          {children}
        </div>
      </div>
    </div>
  )
}

export function SignInLayout(props: SignInLayoutProps) {
  const isDark = props.theme === 'dark'
  const fallbackClass = props.fallbackClassName || (isDark ? 'bg-gray-950' : 'bg-gray-50')
  const spinnerClass = isDark
    ? 'border-gray-700 border-t-purple-400'
    : 'border-gray-200 border-t-gray-600'

  return (
    <Suspense
      fallback={
        <div className={`min-h-screen flex items-center justify-center ${fallbackClass}`}>
          <div className={`w-5 h-5 border-2 rounded-full animate-spin ${spinnerClass}`} />
        </div>
      }
    >
      <SignInLayoutInner {...props} />
    </Suspense>
  )
}
