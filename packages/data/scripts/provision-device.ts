/**
 * Provision an HW device (track 019 P3, app-side half).
 *
 * Creates the `Device` row and its `DeviceSeat` binding, and prints the code to
 * put on the sticker. The hardware half — flashing firmware over USB and printing
 * the label — is `../sunbnb-hw`'s job (ADR 0010); this is the database step of
 * that run.
 *
 * There is **no secret to hand over** (track 019 Q9): every device carries the
 * same `User-Agent` needle, so provisioning mints an identifier and nothing else.
 * That is why this is ~100 lines instead of the mint→flash→print one-shot-token
 * ceremony earlier drafts of the track designed.
 *
 *   npm run device:provision -- --seats <itemId,itemId>   # local
 *   npm run device:provision:test -- --seats <itemId,itemId>
 *   npm run device:provision:production -- --seats <itemId,itemId>
 *
 * Flags:
 *   --seats <ids>   REQUIRED. Comma-separated InventoryItem ids in **LED MOUNT
 *                   ORDER** — first id is the leftmost segment. This is a
 *                   physical fact you read off the installed device, not a sort.
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
  seats: string[]
  code?: string
  mac?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }

  const seats = (get('--seats') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    seats,
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

  if (args.seats.length === 0) {
    throw new Error(
      'No seats given. Pass --seats <itemId,itemId> in LED MOUNT ORDER ' +
        '(first id = leftmost segment). A device with no seats bound is declined ' +
        'by the state route, so an unbound row would be dead on arrival.',
    )
  }

  if (new Set(args.seats).size !== args.seats.length) {
    throw new Error('Duplicate seat ids — each LED segment must map to a distinct seat.')
  }

  // Validate the binding BEFORE writing. Every check here is a failure the device
  // would otherwise express in the field as a silent amber LED, diagnosable only
  // by someone standing at the parasol.
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: args.seats } },
    select: { id: true, siteId: true, number: true, seatLabel: true, status: true },
  })

  const missing = args.seats.filter((id) => !items.some((i) => i.id === id))
  if (missing.length > 0) {
    throw new Error(`Unknown InventoryItem id(s): ${missing.join(', ')}`)
  }

  // The state route refuses a binding spanning multiple sites — "today" would be
  // ambiguous across venues. Catch it at the bench, not as a 503 on a beach.
  const siteIds = new Set(items.map((i) => i.siteId))
  if (siteIds.size !== 1) {
    throw new Error(
      `Seats span ${siteIds.size} sites (${[...siteIds].join(', ')}). A device is ` +
        'mounted at one venue; the state route rejects a cross-site binding.',
    )
  }

  const inactive = items.filter((i) => i.status !== 'active')
  if (inactive.length > 0) {
    // Not fatal: a seat can be activated later. Worth saying out loud, because the
    // seat will not be bookable and the light will look wrong to whoever installed it.
    console.warn(
      `⚠ ${inactive.length} bound seat(s) are not active: ` +
        inactive.map((i) => `${i.seatLabel ?? i.number} (${i.status})`).join(', '),
    )
  }

  const alreadyBound = await prisma.deviceSeat.findMany({
    where: { itemId: { in: args.seats } },
    select: { itemId: true, device: { select: { code: true } } },
  })
  if (alreadyBound.length > 0) {
    throw new Error(
      'Seat(s) already under another device: ' +
        alreadyBound.map((b) => `${b.itemId} → ${b.device.code}`).join(', ') +
        '. Rebind by deleting the old DeviceSeat row first.',
    )
  }

  if (args.code && !isValidDeviceCode(args.code)) {
    throw new Error(
      `--code "${args.code}" is not a valid device code (6 Crockford base32 symbols, no I L O U).`,
    )
  }

  const byId = new Map(items.map((i) => [i.id, i]))
  const order = args.seats
    .map((id, position) => {
      const item = byId.get(id)!
      return `    ${position}: ${item.seatLabel ?? item.number} (${id})`
    })
    .join('\n')

  console.log(`Site:  ${[...siteIds][0]}`)
  console.log(`Seats (LED mount order, 0 = leftmost):\n${order}`)

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
          seats: {
            create: args.seats.map((itemId, position) => ({ itemId, position })),
          },
        },
        select: { id: true, code: true },
      })

      console.log(`\n✅ Provisioned device ${device.id}`)
      console.log(`\n    CODE: ${device.code}\n`)
      console.log('Next: flash the firmware and print this code on the sticker')
      console.log('(../sunbnb-hw ADR 0010). The device serves while `provisioned`;')
      console.log("flip status to 'active' once it is installed and verified.")
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
