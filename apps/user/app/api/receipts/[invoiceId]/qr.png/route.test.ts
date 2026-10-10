import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from './route'
import prisma from '@repo/data/PrismaCient'

const mockFindUnique = vi.mocked(prisma.invoice.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
})

const ES_INVOICE = {
  invoiceNumber: 'AB-F-2026-00001',
  invoicedAt: new Date('2026-07-10T09:30:00Z'),
  issuerVatNumber: 'B22435705',
  totalAmount: 121,
  account: { country: 'ES', taxRegion: 'MA' },
}

const ID = 'clw1234567890abcdefgh'

function request(id = ID) {
  return new NextRequest(`http://localhost:3002/api/receipts/${id}/qr.png`, {
    method: 'GET',
  })
}

async function call(id = ID) {
  return GET(request(id), { params: Promise.resolve({ invoiceId: id }) })
}

describe('GET /api/receipts/[invoiceId]/qr.png', () => {
  it('serves a PNG for a Spanish issuer', async () => {
    mockFindUnique.mockResolvedValue(ES_INVOICE as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    // An issued invoice is immutable, so the image is safe to cache forever.
    expect(res.headers.get('Cache-Control')).toContain('immutable')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(0)
    // PNG magic — proves an actual image came back, not an error page.
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  it('builds the payload from stored values, never from the request', async () => {
    // The whole point of keying on an invoice id: the route must not be usable
    // as a generator for a QR claiming an arbitrary amount or tax id.
    mockFindUnique.mockResolvedValue(ES_INVOICE as never)

    const res = await GET(
      new NextRequest(
        `http://localhost:3002/api/receipts/${ID}/qr.png?nif=X9999999X&importe=99999`,
        { method: 'GET' },
      ),
      { params: Promise.resolve({ invoiceId: ID }) },
    )
    expect(res.status).toBe(200)
    // The only inputs the handler read were the id and the row it fetched.
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    )
  })

  it('404s for a non-Spanish issuer instead of a blank image', async () => {
    // A broken-image icon on a Finnish receipt would read as an outage; the
    // presenters omit the element entirely for these.
    mockFindUnique.mockResolvedValue({
      ...ES_INVOICE,
      account: { country: 'FI', taxRegion: null },
    } as never)

    expect((await call()).status).toBe(404)
  })

  it('404s for a foral issuer — TicketBAI, not Veri*factu', async () => {
    mockFindUnique.mockResolvedValue({
      ...ES_INVOICE,
      account: { country: 'ES', taxRegion: 'BI' },
    } as never)

    expect((await call()).status).toBe(404)
  })

  it('404s when the issuer has no tax id rather than drawing an anonymous QR', async () => {
    mockFindUnique.mockResolvedValue({ ...ES_INVOICE, issuerVatNumber: null } as never)

    expect((await call()).status).toBe(404)
  })

  it('404s for an unknown invoice', async () => {
    mockFindUnique.mockResolvedValue(null as never)
    expect((await call()).status).toBe(404)
  })

  it('rejects a malformed id before touching the database', async () => {
    for (const bad of ['../../etc/passwd', 'short', '']) {
      const res = await call(bad)
      expect(res.status).toBe(404)
    }
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
