'use client'

import { resolveStubCheckout } from './actions'

export default function StubButtons({ orderCode }: { orderCode: string }) {
  return (
    <div className="flex gap-3">
      <button className="btn-primary" onClick={() => resolveStubCheckout(orderCode, 'pay')}>
        Pay
      </button>
      <button className="btn-secondary" onClick={() => resolveStubCheckout(orderCode, 'fail')}>
        Fail
      </button>
    </div>
  )
}
