/**
 * Admin Impersonation Tokens
 *
 * The token is a single-use, short-lived bearer that lets the admin app hand
 * off a browser to the partner or user app and have that app accept the
 * handoff as the target user. The token is signed (HMAC-SHA256 over
 * `AUTH_SECRET`) so the receiving app can verify it without a DB round-trip,
 * and its `jti` is registered in `impersonation_log` on consumption to make
 * replay a unique-constraint violation.
 *
 * Import as `@repo/data/impersonation`.
 */

import crypto from 'node:crypto'
import prisma from '../index'

const TOKEN_VERSION = 1 as const
const DEFAULT_TTL_SECONDS = 5 * 60
const MAX_TTL_SECONDS = 60 * 60

export type ImpersonationApp = 'partner' | 'user'

interface TokenPayload {
  v: typeof TOKEN_VERSION
  sub: string // target user id
  admin: string // admin user id
  app: ImpersonationApp
  jti: string
  iat: number // unix seconds
  exp: number // unix seconds
}

export class ImpersonationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_token'
      | 'expired'
      | 'replay'
      | 'wrong_app'
      | 'misconfigured',
    message: string,
  ) {
    super(message)
    this.name = 'ImpersonationError'
  }
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET
  if (!s) {
    throw new ImpersonationError(
      'misconfigured',
      'AUTH_SECRET is required to sign impersonation tokens',
    )
  }
  return s
}

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function base64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

function signPayload(payload: TokenPayload, secret: string): string {
  const encoded = base64urlEncode(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest()
  return `${encoded}.${base64urlEncode(sig)}`
}

function verifyToken(token: string, secret: string, now: number): TokenPayload {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) {
    throw new ImpersonationError('invalid_token', 'Malformed token')
  }
  const encoded = token.slice(0, dot)
  const providedSigB64 = token.slice(dot + 1)

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest()
  let providedSig: Buffer
  try {
    providedSig = base64urlDecode(providedSigB64)
  } catch {
    throw new ImpersonationError('invalid_token', 'Malformed signature')
  }
  if (providedSig.length !== expectedSig.length) {
    throw new ImpersonationError('invalid_token', 'Invalid signature')
  }
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) {
    throw new ImpersonationError('invalid_token', 'Invalid signature')
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(base64urlDecode(encoded).toString('utf8'))
  } catch {
    throw new ImpersonationError('invalid_token', 'Malformed payload')
  }

  if (payload.v !== TOKEN_VERSION) {
    throw new ImpersonationError('invalid_token', 'Token version mismatch')
  }
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.admin !== 'string' ||
    typeof payload.jti !== 'string' ||
    (payload.app !== 'partner' && payload.app !== 'user') ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    throw new ImpersonationError('invalid_token', 'Malformed payload fields')
  }
  if (payload.exp <= now) {
    throw new ImpersonationError('expired', 'Token expired')
  }

  return payload
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface CreateImpersonationTokenInput {
  adminId: string
  targetUserId: string
  app: ImpersonationApp
  ttlSeconds?: number
}

export interface CreatedImpersonationToken {
  token: string
  tokenId: string
  expiresAt: Date
}

export function createImpersonationToken(
  input: CreateImpersonationTokenInput,
): CreatedImpersonationToken {
  if (!input.adminId) throw new ImpersonationError('invalid_token', 'adminId is required')
  if (!input.targetUserId) {
    throw new ImpersonationError('invalid_token', 'targetUserId is required')
  }
  if (input.app !== 'partner' && input.app !== 'user') {
    throw new ImpersonationError('invalid_token', `Invalid app: ${input.app}`)
  }
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
    throw new ImpersonationError(
      'invalid_token',
      `ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}`,
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomBytes(16).toString('hex')
  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    sub: input.targetUserId,
    admin: input.adminId,
    app: input.app,
    jti,
    iat: now,
    exp: now + ttl,
  }
  const token = signPayload(payload, getSecret())
  return { token, tokenId: jti, expiresAt: new Date(payload.exp * 1000) }
}

export interface ConsumeContext {
  /** Optional caller app — if set, must match the token's `app` field. */
  expectedApp?: ImpersonationApp
  ip?: string | null
  userAgent?: string | null
}

export interface ConsumedImpersonationToken {
  adminId: string
  targetUserId: string
  app: ImpersonationApp
  tokenId: string
}

/**
 * Verify a token and atomically claim its JTI by inserting an
 * `impersonation_log` row. Replay attempts surface as `code: 'replay'`.
 */
export async function consumeImpersonationToken(
  token: string,
  ctx: ConsumeContext = {},
): Promise<ConsumedImpersonationToken> {
  const payload = verifyToken(token, getSecret(), Math.floor(Date.now() / 1000))

  if (ctx.expectedApp && ctx.expectedApp !== payload.app) {
    throw new ImpersonationError(
      'wrong_app',
      `Token is for "${payload.app}", consumer is "${ctx.expectedApp}"`,
    )
  }

  try {
    await prisma.impersonationLog.create({
      data: {
        adminId: payload.admin,
        targetUserId: payload.sub,
        tokenId: payload.jti,
        app: payload.app,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'P2002') {
      throw new ImpersonationError('replay', 'Token already consumed')
    }
    throw err
  }

  return {
    adminId: payload.admin,
    targetUserId: payload.sub,
    app: payload.app,
    tokenId: payload.jti,
  }
}

/**
 * Mark an impersonation session as ended. Idempotent: a token that was never
 * consumed, or that was already ended, leaves the DB unchanged. Returns the
 * number of rows updated so callers can detect "ended already".
 */
export async function endImpersonation(tokenId: string): Promise<number> {
  const res = await prisma.impersonationLog.updateMany({
    where: { tokenId, endedAt: null },
    data: { endedAt: new Date() },
  })
  return res.count
}

// ─── Internal helpers exposed for testing ───────────────────────────────────

export const __test = {
  signPayload,
  verifyToken,
  TOKEN_VERSION,
}
