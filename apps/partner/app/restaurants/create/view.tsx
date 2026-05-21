'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRestaurant } from '../[id]/actions'

interface Props {
  availableSites: Array<{ id: string; name: string }>
}

export default function CreateRestaurantView({ availableSites }: Props) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [siteId, setSiteId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setErrors(['Name is required'])
      return
    }
    setSubmitting(true)
    setErrors([])

    const res = await createRestaurant({
      name: name.trim(),
      siteId: siteId || undefined,
    })

    setSubmitting(false)

    if (res.status === 'ok') {
      router.push(`/restaurants/${res.restaurantId}`)
    } else {
      setErrors(res.errors ?? ['Something went wrong'])
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Create restaurant</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Set up a new restaurant to manage table reservations, menus, and opening hours.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Name */}
        <div>
          <label htmlFor="restaurant-name" className="block text-sm font-medium text-gray-700 mb-1">
            Restaurant name <span className="text-red-500">*</span>
          </label>
          <input
            id="restaurant-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chiringuito El Sol"
            required
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        {/* Site picker — only shown if the user has linkable sites */}
        {availableSites.length > 0 && (
          <div>
            <label htmlFor="linked-site" className="block text-sm font-medium text-gray-700 mb-1">
              Link to a site (optional)
            </label>
            <select
              id="linked-site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white"
            >
              <option value="">No site link</option>
              {availableSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Linking copies the site&apos;s opening hours as a starting point.
            </p>
          </div>
        )}

        {/* Error display */}
        {errors.length > 0 && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            {errors.map((err, i) => (
              <p key={i} className="text-sm text-red-700">
                {err}
              </p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Creating…' : 'Create restaurant'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/restaurants')}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
