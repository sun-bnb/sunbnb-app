// pages/api/cleanup-reservations.ts
import prisma from '@repo/data/PrismaCient'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: Request) {
  
  // delete any reservation still in "pending" created > 15 minutes ago:
  const cutoff = new Date(Date.now() - 15 * 60 * 1000)
  const result = await prisma.reservation.deleteMany({
    where: {
      status: { in: [ 'pending', 'processing' ] },
      createdAt: { lt: cutoff },
    },
  })

  return NextResponse.json({ deleted: result.count })

}
