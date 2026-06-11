'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getTokens, getOwnedSites, createToken, deleteToken } from './actions'

interface Token {
  id: string
  expires: string | Date
  resources: string[]
  createdAt: string | Date
}

interface OwnedSite {
  id: string
  name: string | null
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://sunbnb.app'

function TokenStatusBadge({ expires }: { expires: string | Date }) {
  const t = useTranslations('Security')
  const isExpired = new Date(expires) < new Date()
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
      isExpired
        ? 'bg-red-50 text-red-600'
        : 'bg-green-50 text-green-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-red-400' : 'bg-green-500'}`} />
      {isExpired ? t('expired') : t('active')}
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('Security')
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error(err)
    }
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
      title={label}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {t('copied')}
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
          </svg>
          {t('copy')}
        </>
      )}
    </button>
  )
}

const SITE_RESOURCES: { key: 'manage' | 'orders'; path: string; labelKey: string; descKey: string; icon: React.ReactNode }[] = [
  {
    key: 'manage',
    path: 'manage',
    labelKey: 'resourceManageLabel',
    descKey: 'resourceManageDesc',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
      </svg>
    ),
  },
  {
    key: 'orders',
    path: 'orders',
    labelKey: 'resourceOrdersLabel',
    descKey: 'resourceOrdersDesc',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
      </svg>
    ),
  },
]

function ResourceLinks({ tokenId, sites }: { tokenId: string; sites: OwnedSite[] }) {
  const t = useTranslations('Security')
  const base = APP_URL.replace(/\/$/, '')

  if (sites.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">{t('noSites')}</p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">{t('linksTitle')}</p>
      <ul className="space-y-3">
        {sites.map((site) => (
          <li key={site.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-800 truncate">{site.name || 'Unnamed site'}</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {SITE_RESOURCES.map(resource => {
                const url = `${base}/sites/${site.id}/${resource.path}?key=${tokenId}`
                return (
                  <li key={resource.key} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="mt-0.5 text-gray-400 flex-shrink-0">{resource.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-700">{t(resource.labelKey as any)}</p>
                      <p className="text-[11px] text-gray-400 leading-snug">{t(resource.descKey as any)}</p>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-1 text-[11px] font-mono text-gray-500 hover:text-gray-900 truncate"
                      >
                        {url}
                      </a>
                    </div>
                    <CopyButton value={url} label={t('copyLink')} />
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SecurityView() {
  const t = useTranslations('Security')
  const [tokens, setTokens] = useState<Token[]>([])
  const [sites, setSites] = useState<OwnedSite[]>([])
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTokenId, setExpandedTokenId] = useState<string | null>(null)

  useEffect(() => {
    getTokens().then(setTokens)
    getOwnedSites().then(setSites)
  }, [])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    setCreatedToken(null)
    try {
      const res = await createToken()
      if (res.status !== 'ok' || !res.token) {
        setError(t('createError'))
        return
      }
      setCreatedToken(res.token)
      const updated = await getTokens()
      setTokens(updated)
      setExpandedTokenId(res.token)
    } catch (err) {
      console.error(err)
      setError(t('createError'))
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('deleteConfirmBody'))) return
    try {
      await deleteToken(id)
      setTokens(prev => prev.filter(token => token.id !== id))
      if (expandedTokenId === id) setExpandedTokenId(null)
    } catch (err) {
      console.error(err)
    }
  }

  const activeTokens = tokens.filter(token => new Date(token.expires) >= new Date())
  const expiredTokens = tokens.filter(token => new Date(token.expires) < new Date())

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('headerSub', { count: tokens.length, active: activeTokens.length })}
          </p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {creating ? t('creating') : t('newAccessKey')}
        </button>
      </div>

      {/* Intro */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-sm text-blue-900">
        <p className="font-medium mb-1">{t('introTitle')}</p>
        <p className="text-blue-800/90 leading-relaxed">{t('intro')}</p>
        <p className="text-blue-800/70 mt-2 text-xs">{t('validityNote')}</p>
      </div>

      {/* Success banner */}
      {createdToken && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-green-800">{t('accessKeyCreated')}</p>
            <p className="text-xs text-green-700/80 mt-0.5">{t('accessKeyHint')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="block flex-1 text-xs text-green-700 bg-green-100 rounded px-2 py-1 font-mono break-all">
                {createdToken}
              </code>
              <CopyButton value={createdToken} label={t('copy')} />
            </div>
          </div>
          <button onClick={() => setCreatedToken(null)} className="text-green-400 hover:text-green-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3" role="alert">
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
        <div className="space-y-3">
          {[...activeTokens, ...expiredTokens].map((token) => {
            const isExpanded = expandedTokenId === token.id
            return (
              <div key={token.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <button
                    onClick={() => setExpandedTokenId(isExpanded ? null : token.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left"
                  >
                    <svg
                      className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono text-gray-600 bg-gray-50 rounded px-1.5 py-0.5">
                          {token.id.slice(0, 12)}…
                        </code>
                        <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                          {t('fullAccess')}
                        </span>
                        <TokenStatusBadge expires={token.expires} />
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {t('createdOn', { date: formatDate(token.createdAt) })}
                        {' · '}
                        {t('expiresOn', { date: formatDate(token.expires) })}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDelete(token.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title={t('deleteTitle')}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-4">
                    <ResourceLinks tokenId={token.id} sites={sites} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-gray-300 rounded-xl">
          <svg className="mx-auto w-10 h-10 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          <p className="text-sm text-gray-500 mb-4">{t('noTokens')}</p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {creating ? t('creating') : t('createFirst')}
          </button>
        </div>
      )}
    </div>
  )
}
