import prisma from '@repo/data/PrismaCient'

let tableReady = false

async function ensureTable() {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'general',
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'general'
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_chat_channel_id ON chat_messages (channel, id)
  `)
  tableReady = true
}

export async function GET(request: Request) {
  await ensureTable()
  const { searchParams } = new URL(request.url)
  const after = parseInt(searchParams.get('after') || '0', 10)
  const channel = (searchParams.get('ch') || 'general').slice(0, 50)
  const rows: { id: number; username: string; message: string; created_at: Date }[] =
    await prisma.$queryRawUnsafe(
      'SELECT id, username, message, created_at FROM chat_messages WHERE channel = $1 AND id > $2 ORDER BY id ASC LIMIT 200',
      channel,
      after,
    )
  return Response.json(
    rows.map((r) => ({ id: r.id, u: r.username, m: r.message, t: r.created_at })),
  )
}

export async function POST(request: Request) {
  await ensureTable()
  const body = await request.json()
  const username = String(body.u || '').slice(0, 30).trim()
  const message = String(body.m || '').slice(0, 2000).trim()
  const channel = String(body.ch || 'general').slice(0, 50).trim()
  if (!username || !message) {
    return Response.json({ error: 'missing fields' }, { status: 400 })
  }
  const rows: { id: number }[] = await prisma.$queryRawUnsafe(
    'INSERT INTO chat_messages (channel, username, message) VALUES ($1, $2, $3) RETURNING id',
    channel,
    username,
    message,
  )
  return Response.json({ id: rows[0]?.id })
}

export async function DELETE(request: Request) {
  await ensureTable()
  const { searchParams } = new URL(request.url)
  const channel = (searchParams.get('ch') || '').slice(0, 50).trim()
  if (!channel) {
    return Response.json({ error: 'missing channel' }, { status: 400 })
  }
  await prisma.$executeRawUnsafe(
    'DELETE FROM chat_messages WHERE channel = $1',
    channel,
  )
  return Response.json({ ok: true })
}
