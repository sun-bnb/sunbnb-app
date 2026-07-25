// Pure helpers for Mollie applicationFee handling — NO prisma, client-safe.
//
// Mollie for Platforms refuses to route an applicationFee on a payment created
// on the platform's OWN organization ("Application fees can not be created for
// your own account", 422). That happens whenever a venue is operated by the
// platform itself (the partner's OAuth connection is to our org — e.g. the
// founder's own restaurants/sites). Real third-party partners are unaffected.
//
// Strategy (provider-authoritative, zero config): attempt the payment WITH the
// fee; on exactly this rejection, retry once WITHOUT it and log loudly. The
// commission for platform-owned venues is a self-charge anyway — economically
// meaningless — so skipping it is correct, not lossy.

/** Matches Mollie's own-account applicationFee rejection message. */
export function isOwnAccountApplicationFeeError(message: string | null | undefined): boolean {
  return /application fees? can ?not be created for your own account/i.test(message ?? '')
}

/**
 * Run a Mollie payment-create with the own-account applicationFee fallback.
 * `create` is called with `params`; if it throws a 422 whose message matches
 * the own-account rejection AND the params carried an applicationFee, it is
 * retried exactly once without the fee. Any other error rethrows untouched.
 *
 * Works with the Mollie SDK client (ApiError carries statusCode + message):
 *   createMolliePaymentWithFeeFallback((p) => mollie.payments.create(p), params, '[TabPayment]')
 */
export async function createMolliePaymentWithFeeFallback<
  TParams extends { applicationFee?: unknown },
  TPayment,
>(
  create: (params: TParams) => Promise<TPayment>,
  params: TParams,
  logTag: string,
): Promise<{ payment: TPayment; feeSkipped: boolean }> {
  try {
    const payment = await create(params)
    return { payment, feeSkipped: false }
  } catch (error: any) {
    const message = error?.message ?? error?.detail
    if (
      params.applicationFee &&
      error?.statusCode === 422 &&
      isOwnAccountApplicationFeeError(message)
    ) {
      console.warn(
        `${logTag} Own-account applicationFee rejected by Mollie — retrying without fee ` +
          `(platform-operated venue; commission not routed)`,
      )
      const { applicationFee: _dropped, ...rest } = params
      const payment = await create(rest as unknown as TParams)
      return { payment, feeSkipped: true }
    }
    throw error
  }
}
