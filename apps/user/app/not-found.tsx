import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-md p-10 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🏖️</div>
        <h1 className="text-2xl font-semibold text-gray-800 mb-2">Page not found</h1>
        <p className="text-gray-500 mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Link
            href="/sites"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            Back to beaches
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
