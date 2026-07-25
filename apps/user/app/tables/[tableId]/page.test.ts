import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/navigation.notFound must throw to simulate the 404 response
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

// Mock the actions so the page test doesn't hit the DB
vi.mock('./actions', () => ({
  getDineContext: vi.fn(),
  placeTabOrder: vi.fn(),
  getTabState: vi.fn(),
}))

// Mock the client view — it pulls in Image, next-intl, etc.
vi.mock('./view', () => ({ default: () => null }))

import { notFound } from 'next/navigation'
import { getDineContext } from './actions'
import TablePage from './page'

const mockGetDineContext = vi.mocked(getDineContext)
const mockNotFound = vi.mocked(notFound)

const TABLE_ID = 'table-cuid-1'

function makeContext() {
  return {
    restaurant: { id: 'rest-1', name: 'Chiringuito Vento' },
    table: { id: TABLE_ID, number: 5, label: 'T5' },
    products: [
      {
        id: 'prod-1',
        name: 'Agua',
        price: 2.0,
        totalPrice: 2.4,
        tax: 14,
        category: 'drink',
        soldOut: false,
        active: true,
        imageUrl: null,
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TablePage', () => {
  it('calls notFound when getDineContext returns an error', async () => {
    mockGetDineContext.mockResolvedValue({
      status: 'error',
      errors: ['Table not found or unavailable'],
    })

    await expect(
      TablePage({ params: { tableId: TABLE_ID } }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalled()
  })

  it('calls notFound when getDineContext returns feature_disabled', async () => {
    mockGetDineContext.mockResolvedValue({
      status: 'error',
      errors: ['feature_disabled'],
    })

    await expect(
      TablePage({ params: { tableId: TABLE_ID } }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalled()
  })

  it('passes context and tableId to DineView when getDineContext succeeds', async () => {
    const context = makeContext()
    mockGetDineContext.mockResolvedValue({ status: 'ok', context })

    const el: any = await TablePage({ params: { tableId: TABLE_ID } })

    expect(mockNotFound).not.toHaveBeenCalled()
    expect(el.props.context).toBe(context)
    expect(el.props.tableId).toBe(TABLE_ID)
  })

  it('invokes getDineContext with the tableId from params', async () => {
    mockGetDineContext.mockResolvedValue({ status: 'ok', context: makeContext() })

    await TablePage({ params: { tableId: TABLE_ID } })

    expect(mockGetDineContext).toHaveBeenCalledWith(TABLE_ID)
  })
})
