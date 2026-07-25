import { describe, it, expect, vi } from 'vitest'

import {
  isOwnAccountApplicationFeeError,
  createMolliePaymentWithFeeFallback,
} from './mollie-app-fee'

describe('isOwnAccountApplicationFeeError', () => {
  it('matches the live Mollie message verbatim', () => {
    expect(
      isOwnAccountApplicationFeeError('Application fees can not be created for your own account'),
    ).toBe(true)
  })

  it('matches "cannot" and case variants', () => {
    expect(
      isOwnAccountApplicationFeeError('application fees cannot be created for your own account'),
    ).toBe(true)
    expect(
      isOwnAccountApplicationFeeError('APPLICATION FEE CAN NOT BE CREATED FOR YOUR OWN ACCOUNT'),
    ).toBe(true)
  })

  it('matches when embedded in a JSON error body (fetch-style detail)', () => {
    expect(
      isOwnAccountApplicationFeeError(
        '{"status":422,"title":"Unprocessable Entity","detail":"Application fees can not be created for your own account"}',
      ),
    ).toBe(true)
  })

  it('rejects other 422 messages and empty input', () => {
    expect(isOwnAccountApplicationFeeError('The amount is lower than the minimum')).toBe(false)
    expect(isOwnAccountApplicationFeeError('')).toBe(false)
    expect(isOwnAccountApplicationFeeError(null)).toBe(false)
    expect(isOwnAccountApplicationFeeError(undefined)).toBe(false)
  })
})

describe('createMolliePaymentWithFeeFallback', () => {
  const FEE_PARAMS = {
    amount: { value: '10.00', currency: 'EUR' },
    applicationFee: { amount: { value: '0.50', currency: 'EUR' }, description: 'Platform fee' },
  }

  const ownAccountError = () =>
    Object.assign(new Error('Application fees can not be created for your own account'), {
      statusCode: 422,
    })

  it('passes through on success without retrying', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'tr_1' })

    const result = await createMolliePaymentWithFeeFallback(create, FEE_PARAMS, '[test]')

    expect(result).toEqual({ payment: { id: 'tr_1' }, feeSkipped: false })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(FEE_PARAMS)
  })

  it('retries exactly once WITHOUT the applicationFee on the own-account 422', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(ownAccountError())
      .mockResolvedValueOnce({ id: 'tr_2' })

    const result = await createMolliePaymentWithFeeFallback(create, FEE_PARAMS, '[test]')

    expect(result).toEqual({ payment: { id: 'tr_2' }, feeSkipped: true })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]![0]).not.toHaveProperty('applicationFee')
    expect(create.mock.calls[1]![0]).toHaveProperty('amount')
  })

  it('rethrows the own-account 422 when no applicationFee was sent (nothing to drop)', async () => {
    const create = vi.fn().mockRejectedValue(ownAccountError())
    const { applicationFee: _fee, ...noFeeParams } = FEE_PARAMS

    await expect(
      createMolliePaymentWithFeeFallback(create, noFeeParams as any, '[test]'),
    ).rejects.toThrow('own account')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rethrows other 422s untouched', async () => {
    const err = Object.assign(new Error('The amount is lower than the minimum'), {
      statusCode: 422,
    })
    const create = vi.fn().mockRejectedValue(err)

    await expect(
      createMolliePaymentWithFeeFallback(create, FEE_PARAMS, '[test]'),
    ).rejects.toThrow('minimum')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-422 errors untouched (e.g. auth failure)', async () => {
    const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    const create = vi.fn().mockRejectedValue(err)

    await expect(
      createMolliePaymentWithFeeFallback(create, FEE_PARAMS, '[test]'),
    ).rejects.toThrow('Unauthorized')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a retry that also fails propagates the second error', async () => {
    const second = Object.assign(new Error('profile invalid'), { statusCode: 422 })
    const create = vi.fn().mockRejectedValueOnce(ownAccountError()).mockRejectedValueOnce(second)

    await expect(
      createMolliePaymentWithFeeFallback(create, FEE_PARAMS, '[test]'),
    ).rejects.toThrow('profile invalid')
    expect(create).toHaveBeenCalledTimes(2)
  })
})
