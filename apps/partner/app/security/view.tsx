'use client'

import { useEffect, useState } from 'react'
import { getTokens, createToken } from './actions'

export default function SecurityView() {
  const [tokens, setTokens] = useState<any[]>([])
  const [resources, setResources] = useState('')
  const [expires, setExpires] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    async function fetchTokens() {
      const data = await getTokens()
      setTokens(data)
    }
    fetchTokens()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      const date = new Date(expires)
      const resourceArray = resources.split(',').map(r => r.trim()).filter(Boolean)
      const res = await createToken(date, resourceArray)
      setStatus(`Token created: ${res.token}`)
      const updated = await getTokens()
      setTokens(updated)
    } catch (err) {
      console.error(err)
      setStatus('Error creating token')
    }
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Security Tokens</h1>

      <form onSubmit={handleCreate} className="mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Expiration Date</label>
          <input
            type="datetime-local"
            value={expires}
            onChange={e => setExpires(e.target.value)}
            className="w-full border rounded p-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Resources (comma-separated)</label>
          <input
            type="text"
            value={resources}
            onChange={e => setResources(e.target.value)}
            className="w-full border rounded p-2"
            placeholder="e.g. admin,write,read"
            required
          />
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Create Token
        </button>

        {status && <div className="text-sm mt-2">{status}</div>}
      </form>

      <div className="space-y-2">
        {tokens.length === 0 ? (
          <p className="text-gray-500">No tokens found.</p>
        ) : (
          tokens.map(token => (
            <div key={token.id} className="border p-4 rounded shadow">
              <p><strong>ID:</strong> {token.id}</p>
              <p><strong>Expires:</strong> {new Date(token.expires).toLocaleString()}</p>
              <p><strong>Resources:</strong> {token.resources.join(', ')}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
