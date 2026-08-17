/**
 * Provision an HW device (track 019 P3, app-side half).
 *
 * Mints the `Device` row and prints the code to put on the sticker. The hardware
 * half — flashing firmware over USB and printing the label — is `../sunbnb-hw`'s
 * job (ADR 0010); this is the database step of that run.
 *
 * **It does not place the device.** Position is an ADDRESS assigned in the
 * partner fleet UI once the unit is on a pole (track 021). This script used to
 * require `--seats <itemId,itemId>` and write `DeviceSeat` rows binding a device
 * to specific seats; since resolution moved to addresses, nothing read those
 * rows, and the script left the assigned address null — so every device it
 * provisioned was declined on its first poll until someone assigned it anyway.
 * The flag was pure ceremony and is gone.
 *
 * That also matches the model rather than fighting it: devices are
 * interchangeable and easy to move, positions are the durable thing, and whoever
 * runs this at a bench has no business knowing which parasol a unit will end up
 * under.
 *
 * There is **no secret to hand over** (track 019 Q9): every device carries the
 * same `User-Agent` needle, so provisioning mints an identifier and nothing else.
 * That is why this is short instead of the mint→flash→print one-shot-token
 * ceremony earlier drafts of the track designed.
 *
 *   npm run device:provision -- --partner <partnerAccountId>   # local
 *   npm run device:provision:test -- --partner <partnerAccountId>
 *   npm run device:provision:production -- --partner <partnerAccountId>
 *
 * Flags:
 *   --partner <id>  The customer whose fleet list this device appears in. Without
 *                   it nobody can see the device to assign it a location.
 *   --code <code>   Reuse a specific code (a board swap keeps the sticker, ADR
 *                   0003). Validated against the Crockford rules.
 *   --mac <addr>    Record the board's MAC as a provisioning fingerprint.
 *   --dry-run       Validate and print, write nothing.
 */

import prisma from '../index'
import {
  generateDeviceCode,
  isValidDeviceCode,
  normalizeDeviceCode,
} from '../src/device-code'

type Args = {
  code?: string
  mac?: string
  partner?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }

  return {
    code: get('--code'),
    mac: get('--mac'),
    // Track 021 P5: the customer is flashed permanently and decides whose fleet
    // list the device appears in. Without it a provisioned device is invisible
    // to the operator who has to assign it a location.
    partner: get('--partner'),
    dryRun: argv.includes('--dry-run'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.code && !isValidDeviceCode(args.code)) {
    throw new Error(
      `--code "${args.code}" is not a valid device code (6 Crockford base32 symbols, no I L O U).`,
    )
  }

  if (!args.partner) {
    // Not fatal — a device can be re-pointed later — but worth saying out loud:
    // an ownerless device appears in nobody's fleet list, so nobody can assign
    // it a location, and it stays declined forever.
    console.warn('⚠ No --partner given: this device will appear in no fleet list.')
  }

  console.log(`Partner: ${args.partner ?? '(none)'}`)

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  // Retry on the @unique collision rather than pre-checking: at 32^6 a collision
  // is ~0.1% across 1 500 devices, and a check-then-insert would still race.
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = normalizeDeviceCode(args.code ?? generateDeviceCode())
    try {
      const device = await prisma.device.create({
        data: {
          code,
          macAddr: args.mac,
          partnerAccountId: args.partner,
          status: 'provisioned',
        },
        select: { id: true, code: true },
      })

      console.log(`\n✅ Provisioned device ${device.id}`)
      console.log(`\n    CODE: ${device.code}\n`)
      console.log('Next: flash the firmware and print this code on the sticker')
      console.log('(../sunbnb-hw ADR 0010), then assign it a location in the partner')
      console.log("fleet UI — a device with no address is declined until then.")
      console.log("The device serves while `provisioned`; flip status to 'active'")
      console.log('once it is installed and verified.')
      return
    } catch (e: unknown) {
      const isCodeCollision =
        typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002'

      // An explicit --code that collides is a mistake to report, not to retry
      // around: retrying would silently mint a different code than the sticker.
      if (!isCodeCollision || args.code) throw e
      console.warn(`code collision on ${code}, retrying (${attempt}/${MAX_ATTEMPTS})`)
    }
  }

  throw new Error(`Could not mint a free code in ${MAX_ATTEMPTS} attempts.`)
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
