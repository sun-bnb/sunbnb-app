'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getTokens, createToken, deleteToken } from './actions'

interface Token {
  id: string
  expires: string | Date
  resources: string[]
  createdAt: string | Date
}

function TokenStatusBadge({ expires }: { expires: string | Date }) {
  const t = useTranslations('Security')
  const isExpired = new Date(expires) < new Date()
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
      isExpired
        ? 'bg-red-50 text-red-600'
        : 'bg-emerald-50 text-emerald-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-red-400' : 'bg-emerald-500'}`} />
      {isExpired ? t('expired') : t('active')}
    </span>
  )
}

function ResourceTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
      {name}
    </span>
  )
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(d: string | Date) {
  return new Date(d).toLocaleTimeString('en', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function SecurityView() {
  const t = useTranslations('Security')
  const [tokens, setTokens] = useState<Token[]>([])
  const [resources, setResources] = useState('')
  const [expires, setExpires] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTokens().then(setTokens)
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setCreatedToken(null)
    try {
      const date = new Date(expires)
      const resourceArray = resources.split(',').map(r => r.trim()).filter(Boolean)
      const res = await createToken(date, resourceArray)
      setCreatedToken(res.token ?? null)
      const updated = await getTokens()
      setTokens(updated)
      setResources('')
      setExpires('')
      setShowForm(false)
    } catch (err) {
      console.error(err)
      setError(t('createError'))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteToken(id)
      setTokens(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const activeTokens = tokens.filter(t => new Date(t.expires) >= new Date())
  const expiredTokens = tokens.filter(t => new Date(t.expires) < new Date())

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('headerSub', { count: tokens.length, active: activeTokens.length })}
          </p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setCreatedToken(null); setError(null) }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
        >
          {showForm ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              {t('cancel')}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('newAccessKey')}
            </>
          )}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('createAccessKey')}</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('expirationDate')}</label>
              <input
                type="datetime-local"
                value={expires}
                onChange={e => setExpires(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('resources')}</label>
              <input
                type="text"
                value={resources}
                onChange={e => setResources(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-colors"
                placeholder={t('resourcesPlaceholder')}
                required
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('resourcesHint')}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
              >
                {creating ? t('creating') : t('create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success banner */}
      {createdToken && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-emerald-800">{t('accessKeyCreated')}</p>
            <code className="block mt-1 text-xs text-emerald-700 bg-emerald-100 rounded px-2 py-1 font-mono break-all">
              {createdToken}
            </code>
          </div>
          <button onClick={() => setCreatedToken(null)} className="ml-auto text-emerald-400 hover:text-emerald-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Token list */}
      {tokens.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider px-5 py-3">{t('accessKey')}</th>
                <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider px-5 py-3">{t('resources')}</th>
                <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider px-5 py-3">{t('tokenExpiry')}</th>
                <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider px-5 py-3">{t('status')}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...activeTokens, ...expiredTokens].map((token) => (
                <tr key={token.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <code className="text-xs font-mono text-gray-600 bg-gray-50 rounded px-1.5 py-0.5">
                      {token.id.slice(0, 12)}…
                    </code>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {t('createdOn', { date: formatDate(token.createdAt) })}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {token.resources.map((r: string) => (
                        <ResourceTag key={r} name={r} />
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-gray-700">{formatDate(token.expires)}</span>
                    <span className="text-xs text-gray-400 ml-1">{formatTime(token.expires)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <TokenStatusBadge expires={token.expires} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => handleDelete(token.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title={t('deleteTitle')}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-gray-300 rounded-xl">
          <svg className="mx-auto w-10 h-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          <p className="text-sm text-gray-500 mb-4">{t('noTokens')}</p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
          >
            {t('createFirst')}
          </button>
        </div>
      )}
    </div>
  )
}
