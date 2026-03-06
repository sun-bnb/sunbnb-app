import { hash, compare } from 'bcryptjs'
import prisma from '@repo/data/PrismaCient'

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
  let user = await prisma.user.findUnique({ where: { email } })

  // If no user, create one with a hashed password
  if (!user) {
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
