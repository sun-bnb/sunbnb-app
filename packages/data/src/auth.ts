import { hash, compare } from 'bcryptjs'
import prisma from '@repo/data/PrismaCient'
import { rateLimit } from './rate-limit'

/**
 * Shared authentication helper for credentials-based sign in.
 *
 * If the user doesn't exist yet, it creates a new account with a hashed password.
 * If the user exists but has no password (OAuth-only), returns the user with loginError.
 * If the password doesn't match, returns null.
 */
export async function validateOrCreateUser(
  email: string,
  password: string,
  credentials: { loginError?: string }
) {
  // Rate-limit credentials sign-in: 5 attempts per email per 15 minutes
  const rl = rateLimit(`signin:${email.toLowerCase()}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
  if (!rl.allowed) {
    credentials.loginError = 'TooManyAttempts'
    return null
  }

  let user = await prisma.user.findUnique({ where: { email } })

  // If no user, create one with a hashed password
  if (!user) {
    // Enforce password policy on sign-up
    if (!password || password.length < 8) {
      credentials.loginError = 'WeakPassword'
      return null
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      credentials.loginError = 'WeakPassword'
      return null
    }
    const hashedPassword = await hash(password, 12)
    user = await prisma.user.create({
      data: { email, password: hashedPassword },
    })
  }

  // If the user has no password, it's likely an OAuth-only account
  if (!user.password) {
    credentials.loginError = 'OAuthAccountNotLinked'
    return user
  }

  // Validate password
  const isValid = await compare(password, user.password)
  if (!isValid) {
    credentials.loginError = 'CredentialsSignin'
    return null
  }

  return user
}
