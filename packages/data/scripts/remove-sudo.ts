/**
 * One-off: clear the sudo flag on a user in the test DB.
 *
 * Reads POSTGRES_URL_TEST directly from `.env.local` (parsing the file
 * rather than sourcing it, because the connection string contains `&`
 * which the shell mis-parses) and points the prisma client at it.
 *
 * Usage:
 *   npx tsx scripts/remove-sudo.ts <email>
 */
import fs from 'node:fs'
import path from 'node:path'

const email = process.argv[2]
if (!email) {
  console.error('Usage: tsx scripts/remove-sudo.ts <email>')
  process.exit(2)
}

const envPath = path.resolve(__dirname, '../.env.local')
const content = fs.readFileSync(envPath, 'utf8')
const match = content.match(/^\s*(?:export\s+)?POSTGRES_URL_TEST=(.+)$/m)
if (!match) {
  console.error('POSTGRES_URL_TEST not found in packages/data/.env.local')
  process.exit(1)
}
// Strip optional surrounding quotes
const value = match[1]!.trim().replace(/^["']|["']$/g, '')
process.env.POSTGRES_URL = value

async function main() {
  // Dynamic import so prisma sees the POSTGRES_URL we just set.
  const { default: prisma } = await import('../index')

  const before = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, sudo: true },
  })
  if (!before) {
    console.log(`No user with email ${email} on test DB.`)
    await prisma.$disconnect()
    return
  }
  console.log(`Before: ${JSON.stringify(before)}`)

  if (!before.sudo) {
    console.log('User already has sudo=false. Nothing to do.')
    await prisma.$disconnect()
    return
  }

  const after = await prisma.user.update({
    where: { email },
    data: { sudo: false },
    select: { id: true, email: true, sudo: true },
  })
  console.log(`After:  ${JSON.stringify(after)}`)

  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
