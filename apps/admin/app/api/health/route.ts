import prisma from '@repo/data/PrismaCient'
import { NextResponse } from 'next/server'

export async function GET() {
  const start = Date.now()
  let dbStatus = 'unreachable'
  let dbLatency = 0
  let siteCount = 0
  let userCount = 0

  try {
    await prisma.$queryRaw`SELECT 1`
    dbLatency = Date.now() - start
    dbStatus = 'connected'

    const [sites, users] = await Promise.all([
      prisma.site.count(),
      prisma.user.count(),
    ])
    siteCount = sites
    userCount = users
  } catch {
    dbLatency = Date.now() - start
  }

  return NextResponse.json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    db: { status: dbStatus, latency: `${dbLatency}ms` },
    records: { sites: siteCount, users: userCount },
    timestamp: new Date().toISOString(),
  })
}
