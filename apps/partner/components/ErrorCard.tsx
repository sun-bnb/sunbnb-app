import Link from 'next/link'

interface ErrorCardProps {
  title: string
  message: string
  showBackLink?: boolean
}

export default function ErrorCard({ title, message, showBackLink = true }: ErrorCardProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        {showBackLink && (
          <Link
            href="/sites"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to sites
          </Link>
        )}
      </div>
    </div>
  )
}
