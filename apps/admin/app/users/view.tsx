'use client'

import { useState, useCallback } from 'react'
import { addAdminUser, removeAdminUser, searchUsers, deleteUser, type UserSearchResult } from './actions'

interface AdminUser {
  id: string
  email: string
  createdAt: Date
}

export default function UsersView({ initialUsers }: { initialUsers: AdminUser[] }) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // User management state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserSearchResult | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    setAdding(true)
    setError(null)
    const result = await addAdminUser(email)
    setAdding(false)

    if (result.status === 'ok' && result.user) {
      setUsers([result.user, ...users])
      setEmail('')
    } else {
      setError(result.error ?? 'Failed to add user')
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    await removeAdminUser(id)
    setUsers(users.filter((u) => u.id !== id))
    setRemovingId(null)
  }

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    setDeleteError(null)
    setDeleteSuccess(null)
    const results = await searchUsers(searchQuery)
    setSearchResults(results)
    setSearching(false)
  }, [searchQuery])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSearch()
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    setDeleteSuccess(null)
    const result = await deleteUser(deleteTarget.id)
    setDeleting(false)

    if (result.status === 'ok') {
      setDeleteSuccess(`User ${result.email} and all connected data deleted.`)
      setSearchResults(searchResults.filter((u) => u.id !== deleteTarget.id))
      setDeleteTarget(null)
    } else {
      setDeleteError(result.error ?? 'Failed to delete user')
      setDeleteTarget(null)
    }
  }

  return (
    <div className="p-4">

      {/* ── Admin Users Section ─────────────────────────────── */}
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Admin Users</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage which email addresses have admin access.
        </p>
      </div>

      {/* Add user form */}
      <form onSubmit={handleAdd} className="mb-6">
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null) }}
            placeholder="Enter email address"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-40 transition-colors"
          >
            {adding ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </>
            )}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </form>

      {/* Users list */}
      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <svg className="w-10 h-10 mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
          <p className="text-sm">No admin users added yet</p>
        </div>
      ) : (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Added</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide w-20"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30">
                  <td className="px-4 py-3">
                    <span className="text-gray-200">{user.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-500 text-xs">
                      {new Date(user.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(user.id)}
                      disabled={removingId === user.id}
                      className="text-gray-500 hover:text-red-400 disabled:opacity-40 transition-colors p-1"
                      title="Remove admin user"
                    >
                      {removingId === user.id ? (
                        <div className="w-4 h-4 border-2 border-gray-600 border-t-gray-400 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-600">
        {users.length} admin user{users.length !== 1 ? 's' : ''}
      </p>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="border-t border-gray-800 mt-10 mb-10" />

      {/* ── User Management Section ─────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100">User Management</h2>
        <p className="text-sm text-gray-500 mt-1">
          Search for users and delete them along with all connected data.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearchSubmit} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email or name"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-40 transition-colors"
          >
            {searching ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                Search
              </>
            )}
          </button>
        </div>
      </form>

      {/* Status messages */}
      {deleteSuccess && (
        <div className="mb-4 px-3 py-2 bg-green-900/30 border border-green-800 rounded-lg text-sm text-green-400">
          {deleteSuccess}
        </div>
      )}
      {deleteError && (
        <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
          {deleteError}
        </div>
      )}

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Joined</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Sites</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Reservations</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Orders</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide w-20"></th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((u) => (
                <tr key={u.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30">
                  <td className="px-4 py-3">
                    <div>
                      <div className="text-gray-200">{u.email}</div>
                      {u.name && <div className="text-gray-500 text-xs mt-0.5">{u.name}</div>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-500 text-xs">
                      {new Date(u.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-gray-400">{u._count.sites}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-gray-400">{u._count.reservations}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-gray-400">{u._count.orders}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setDeleteTarget(u); setDeleteError(null); setDeleteSuccess(null) }}
                      className="text-gray-500 hover:text-red-400 transition-colors p-1"
                      title="Delete user"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searchResults.length === 0 && searchQuery.trim() && !searching && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <svg className="w-10 h-10 mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <p className="text-sm">No users found</p>
        </div>
      )}

      {/* ── Delete Confirmation Modal ──────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-900/50 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100">Delete User</h3>
                <p className="text-xs text-gray-500">This action cannot be undone</p>
              </div>
            </div>

            <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
              <p className="text-sm text-gray-200 font-medium">{deleteTarget.email}</p>
              {deleteTarget.name && <p className="text-xs text-gray-500 mt-0.5">{deleteTarget.name}</p>}
            </div>

            <p className="text-sm text-gray-400 mb-3">
              This will permanently delete:
            </p>
            <ul className="text-sm text-gray-400 mb-6 space-y-1 ml-4">
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-gray-600" />
                The user account and profile
              </li>
              {deleteTarget._count.sites > 0 && (
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-600" />
                  {deleteTarget._count.sites} site{deleteTarget._count.sites !== 1 ? 's' : ''} and all site data
                </li>
              )}
              {deleteTarget._count.reservations > 0 && (
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-600" />
                  {deleteTarget._count.reservations} reservation{deleteTarget._count.reservations !== 1 ? 's' : ''}
                </li>
              )}
              {deleteTarget._count.orders > 0 && (
                <li className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-gray-600" />
                  {deleteTarget._count.orders} order{deleteTarget._count.orders !== 1 ? 's' : ''}
                </li>
              )}
              <li className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-gray-600" />
                All connected settlements, invoices &amp; sessions
              </li>
            </ul>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-40 transition-colors"
              >
                {deleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Delete User'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
