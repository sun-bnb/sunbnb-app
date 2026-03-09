import { randomBytes, createHash } from 'crypto'
import { hash } from 'bcryptjs'
import prisma from '@repo/data/PrismaCient'
import { sendEmail } from './email'

const TOKEN_EXPIRY_HOURS = 1
const MAX_REQUESTS_PER_HOUR = 3

/**
 * Derive a SHA-256 hex digest from a raw token.
 * Only the hash is stored in the database — the plaintext is sent to the user's email.
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Request a password reset for the given email.
 * Always returns success to avoid leaking whether the email exists.
 */
export async function requestPasswordReset(email: string, appBaseUrl: string) {
  // Validate appBaseUrl against allowed origins to prevent email link injection
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(appBaseUrl)) {
    console.warn(`[PasswordReset] Rejected unrecognised origin: ${appBaseUrl}`)
    return { ok: true } // Silent — don't reveal validation
  }

  const user = await prisma.user.findUnique({ where: { email } })

  // If no user or OAuth-only (no password), silently succeed
  if (!user || !user.password) {
    return { ok: true }
  }

  // Rate-limit: max N requests per email per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recentCount = await prisma.passwordResetToken.count({
    where: {
      userId: user.id,
      createdAt: { gte: oneHourAgo },
    },
  })

  if (recentCount >= MAX_REQUESTS_PER_HOUR) {
    return { ok: true } // Silent — don't reveal rate limiting
  }

  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  // Generate a new token — store only the SHA-256 hash in the DB
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

  await prisma.passwordResetToken.create({
    data: {
      token: tokenHash,
      userId: user.id,
      expiresAt,
    },
  })

  // Send email
  const resetUrl = `${appBaseUrl}/reset-password?token=${token}`

  try {
    await sendEmail({
      to: email,
      subject: 'Reset your password',
      html: passwordResetEmailHtml(resetUrl, TOKEN_EXPIRY_HOURS),
    })
  } catch (err) {
    console.error('Password reset email failed:', err)
    return { ok: false, error: 'Failed to send email. Please try again later.' }
  }

  return { ok: true }
}

/**
 * Consume a reset token and set a new password.
 */
export async function resetPassword(token: string, newPassword: string) {
  // Server-side password strength check
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' }
  }
  if (!/[a-z]/.test(newPassword)) {
    return { ok: false, error: 'Password must contain at least one lowercase letter' }
  }
  if (!/[A-Z]/.test(newPassword)) {
    return { ok: false, error: 'Password must contain at least one uppercase letter' }
  }
  if (!/[0-9]/.test(newPassword)) {
    return { ok: false, error: 'Password must contain at least one number' }
  }

  // Hash the incoming token and look up by hash (plaintext is never stored)
  const tokenHash = hashToken(token)
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  })

  if (!resetToken) {
    return { ok: false, error: 'Invalid or expired reset link.' }
  }

  if (resetToken.usedAt) {
    return { ok: false, error: 'This reset link has already been used.' }
  }

  if (resetToken.expiresAt < new Date()) {
    return { ok: false, error: 'This reset link has expired.' }
  }

  // Hash and save new password
  const hashedPassword = await hash(newPassword, 12)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ])

  return { ok: true }
}

function passwordResetEmailHtml(resetUrl: string, expiryHours: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#faf9f6; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9f6; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0; text-align:center;">
              <h1 style="margin:0; font-size:20px; font-weight:700; color:#111827;">Reset your password</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#4b5563;">
                We received a request to reset your password. Click the button below to choose a new one.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${resetUrl}" style="display:inline-block; padding:12px 32px; background-color:#111827; color:#ffffff; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">
                      Reset password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px; font-size:12px; line-height:1.5; color:#9ca3af;">
                This link expires in ${expiryHours} hour${expiryHours > 1 ? 's' : ''}. If you didn't request this, you can safely ignore this email.
              </p>
              <p style="margin:0; font-size:11px; line-height:1.5; color:#d1d5db; word-break:break-all;">
                ${resetUrl}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px; border-top:1px solid #f3f4f6; text-align:center;">
              <p style="margin:0; font-size:11px; color:#d1d5db;">Sunbnb</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
