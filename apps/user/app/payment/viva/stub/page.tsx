import { notFound } from 'next/navigation'
import { checkoutStubState } from '@repo/data/viva'
import StubButtons from './StubButtons'

/**
 * Dev-only stand-in for Viva's hosted Smart Checkout page (track 028, P4b). The stub order store is
 * in-process module state: it works because the create route and this page run in the SAME Next
 * server process in dev (it would not across serverless instances). 404s unless VIVA_MODE=stub.
 */
export default async function VivaStubPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  if (process.env.VIVA_MODE !== 'stub') notFound()
  const { ref: refParam } = await searchParams
  const ref = refParam ?? ''
  const order = /^\d{10,20}$/.test(ref) ? checkoutStubState.get(ref) : undefined

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="card space-y-4 p-6">
        <h1 className="text-lg font-semibold">Viva checkout (stub)</h1>
        {order ? (
          <>
            <p className="text-sm text-gray-600">Order {ref}</p>
            <p className="text-2xl font-semibold">{(order.amountCents / 100).toFixed(2)} EUR</p>
            <StubButtons orderCode={ref} />
          </>
        ) : (
          <p className="text-sm text-red-600">Unknown stub order.</p>
        )}
      </div>
    </div>
  )
}
