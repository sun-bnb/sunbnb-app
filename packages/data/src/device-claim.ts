/**
 * The partner claim a device makes (track 021).
 *
 * A device is flashed with its customer's PARTNER CODE and sends it on every
 * request. The server treats that as a CLAIM, never as authority, because this
 * endpoint has no authentication: whatever a device asserts, a stranger can
 * assert too.
 *
 * Three cases, and the third is the one that matters:
 *
 *   - **Unknown device code** → register it to the claimed customer. This is
 *     self-registration; without it a device that polls before anyone
 *     provisioned a row is invisible everywhere, with no entry to act on.
 *     Worst case is deletable junk in a fleet list.
 *   - **Known code, same customer** → nothing to do.
 *   - **Known code, DIFFERENT customer** → record the claim, change nothing. A
 *     legitimately reflashed device and a spoofed claim are indistinguishable
 *     from here, so a human resolves the handful of real ones rather than an
 *     unauthenticated caller being able to re-point someone else's hardware.
 *
 * SERVER-ONLY — imports the Prisma client.
 */

import prisma from '../index'
import { isValidPartnerCode, normalizePartnerCode } from './partner-code'

export type ClaimOutcome =
  | 'no-claim'
  | 'invalid-claim'
  | 'unknown-partner'
  | 'registered'
  | 'matches'
  | 'mismatch-recorded'

/**
 * Apply a device's partner claim. Returns what happened, so the caller can log
 * or ignore it — telemetry ignores it, because nothing here may change the 204.
 */
export async function applyDeviceClaim(
  deviceCode: string,
  rawClaim: string | null,
): Promise<ClaimOutcome> {
  if (!rawClaim) return 'no-claim'
  if (!isValidPartnerCode(rawClaim)) return 'invalid-claim'
  const claimed = normalizePartnerCode(rawClaim)

  const partner = await prisma.partnerAccount.findUnique({
    where: { code: claimed },
    select: { userId: true },
  })
  // An unknown partner code is not an error worth surfacing to the device — it
  // is a mis-flash or a stranger, and either way there is nothing to attach to.
  if (!partner) return 'unknown-partner'

  const device = await prisma.device.findUnique({
    where: { code: deviceCode },
    select: { id: true, partnerAccountId: true },
  })

  if (!device) {
    // Self-registration. `provisioned` rather than `active`: it exists, it is
    // talking, and nobody has installed or verified it yet.
    await prisma.device.create({
      data: {
        code: deviceCode,
        status: 'provisioned',
        partnerAccountId: partner.userId,
        claimedPartnerCode: claimed,
      },
    })
    return 'registered'
  }

  if (device.partnerAccountId === partner.userId) {
    // Clear a stale mismatch: the disagreement has resolved itself.
    if (device.partnerAccountId) {
      await prisma.device.updateMany({
        where: { id: device.id, claimedPartnerCode: { not: null } },
        data: { claimedPartnerCode: null },
      })
    }
    return 'matches'
  }

  // Recorded, NOT applied — the whole point of the rule.
  await prisma.device.update({
    where: { id: device.id },
    data: { claimedPartnerCode: claimed },
  })
  return 'mismatch-recorded'
}
