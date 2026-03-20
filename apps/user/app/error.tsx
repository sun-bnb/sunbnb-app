'use client'

import { useEffect } from 'react'
import Link from 'next/link'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-md p-10 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🌊</div>
        <h1 className="text-2xl font-semibold text-gray-800 mb-2">Something went wrong</h1>
        <p className="text-gray-500 mb-8">
          An unexpected error occurred. You can try again or head back to browse beaches.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <button
            onClick={reset}
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            Try again
          </button>
          <Link
            href="/sites"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Back to beaches
          </Link>
        </div>
      </div>
    </div>
  )
}
