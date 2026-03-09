import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { NextResponse } from 'next/server'

export async function GET() {
  // Check if caller is an authenticated sudo user
  let isSudo = false
  try {
    const session = await auth()
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { sudo: true },
      })
      isSudo = !!user?.sudo
    }
  } catch {
    // Not authenticated — continue with minimal response
  }

  const start = Date.now()
  let dbStatus = 'unreachable'
  let dbLatency = 0

  try {
    await prisma.$queryRaw`SELECT 1`
    dbLatency = Date.now() - start
    dbStatus = 'connected'
  } catch {
    dbLatency = Date.now() - start
  }

  // Public response: only connectivity status
  const response: Record<string, unknown> = {
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
  }

  // Sudo users get full operational details
  if (isSudo) {
    const [siteCount, userCount] = await Promise.all([
      prisma.site.count(),
      prisma.user.count(),
    ])
    response.db = { status: dbStatus, latency: `${dbLatency}ms` }
    response.records = { sites: siteCount, users: userCount }
  }

  return NextResponse.json(response)
}
