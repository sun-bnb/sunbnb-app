// Cancellation / modify deadline policy — pure, no DB. The deadline is stored on
// the restaurant (`cancellationDeadlineHours`) and read by the apps; this module
// owns the rule so it stays shared + testable.

/**
 * Is `now` within `deadlineHours` of the reservation start — i.e. too late to
 * cancel/modify online? Null / non-positive deadline means no restriction.
 *
 * Policy (decided 2026-05-25): before the deadline a cancel refunds the deposit
 * and a modify is allowed; within the deadline a modify is blocked and a cancel
 * forfeits the deposit (kept, not refunded).
 */
export function isPastCancellationDeadline(
  from: Date,
  deadlineHours: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!deadlineHours || deadlineHours <= 0) return false
  const deadlineMs = from.getTime() - deadlineHours * 3600_000
  return now.getTime() >= deadlineMs
}
