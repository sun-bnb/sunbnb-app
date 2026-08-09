import NextAuth, { NextAuthResult, CredentialsSignin } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import FacebookProvider from 'next-auth/providers/facebook'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { headers } from 'next/headers'
import prisma from '@repo/data/PrismaCient'
import { validateOrCreateUser } from '@repo/data/auth'
import { consumeImpersonationToken } from '@repo/data/impersonation'
import { resolveMissingMollieScopes } from '@/app/api/_lib/mollie-permissions'
import { SiteProps } from '@/types/shared'

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
    // 8-hour IDLE timeout, not an absolute one: @auth/core re-signs the JWT with
    // a fresh expiry on every session read under the `jwt` strategy (`updateAge`
    // applies only to the database strategy). So an operator is never logged out
    // mid-shift, but an overnight close-to-open gap always exceeds 8h — which
    // means partners sign in roughly daily. The Mollie permission check in the
    // `jwt` callback below rides on that: it only runs at sign-in, so session
    // length is what determines how promptly a missing scope is noticed.
    maxAge: 8 * 60 * 60,
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET!,
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
    }),
    CredentialsProvider({
      credentials: {
        email: { label: 'Email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (rawCredentials) => {
        const credentials = rawCredentials as {
          email: string
          password: string
          loginError?: string
        }
        const { email, password } = credentials
        const user = await validateOrCreateUser(email, password, credentials)
        if (!user) {
          const error = new CredentialsSignin()
          error.code = credentials.loginError || 'CredentialsSignin'
          throw error
        }
        return user
      },
    }),
    // Admin impersonation. The token is single-use and signed with AUTH_SECRET;
    // consumeImpersonationToken writes the audit row (or throws on replay).
    CredentialsProvider({
      id: 'impersonation',
      name: 'Impersonation',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      authorize: async (raw) => {
        const token = typeof raw?.token === 'string' ? raw.token : null
        if (!token) return null
        const h = await headers()
        const ip =
          h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          h.get('x-real-ip') ||
          null
        const userAgent = h.get('user-agent')
        const consumed = await consumeImpersonationToken(token, {
          expectedApp: 'partner',
          ip,
          userAgent,
        })
        const user = await prisma.user.findUnique({
          where: { id: consumed.targetUserId },
        })
        if (!user) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          // Custom claims picked up by jwt callback
          impersonating: true,
          impersonatorId: consumed.adminId,
          impersonationTokenId: consumed.tokenId,
        } as never
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      session.user.id = token.id as string
      // Computed once at sign-in; the app shell reads it to decide whether to
      // show the "reconnect Mollie" notification.
      ;(session.user as any).missingMollieScopes = token.missingMollieScopes ?? []
      if (token.impersonating) {
        (session.user as any).impersonating = true
        ;(session.user as any).impersonatorId = token.impersonatorId
        ;(session.user as any).impersonationTokenId = token.impersonationTokenId
      }
      return session
    },
    async signIn({ credentials, account }) {
      // The impersonation provider has already authorised the handoff via a
      // single-use signed token; skip the credentials-flow error handling.
      if (account?.provider === 'impersonation') return true
      const loginError = credentials?.loginError
      if (loginError) {
        return `/api/auth/signin?error=${loginError}`
      }
      return true
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as any
        if (u.impersonating) {
          // Impersonation flow: id from authorize() is already the DB user id.
          token.id = u.id
          token.name = u.name
          token.email = u.email
          token.impersonating = true
          token.impersonatorId = u.impersonatorId
          token.impersonationTokenId = u.impersonationTokenId
        } else {
          // user.id from OAuth providers may be the provider's sub (e.g. Google numeric ID),
          // not the Prisma-generated CUID. Look up the DB record by email to get the real id.
          const dbUser = user.email
            ? await prisma.user.findUnique({ where: { email: user.email } })
            : null
          token.id = dbUser?.id ?? user.id
          token.name = user.name
          token.email = user.email
        }

        // Sign-in only (`user` is undefined on subsequent session reads), so
        // this costs one Mollie call per login rather than one per request.
        // `resolveMissingMollieScopes` fails open and is time-bounded — a Mollie
        // outage must never block a partner from signing in.
        token.missingMollieScopes = await resolveMissingMollieScopes(token.id as string)
      } else if (trigger === 'update' && token.id) {
        // Explicit client-side session refresh — the one path that re-checks
        // without a new login. Used after a Mollie (re)connect so the banner
        // clears immediately instead of lingering until the next sign-in.
        token.missingMollieScopes = await resolveMissingMollieScopes(token.id as string)
      }
      return token
    },
  },
  pages: {
    signIn: '/sign-in',
    newUser: '/onboarding',
  },
})

export async function checkSiteAuth(session: any, site: SiteProps): Promise<boolean> {
  if (!session?.user) throw new Error('Not authenticated')
  const sudoUsers = await prisma.user.findMany({
    where: {
      sudo: true
    }
  })
  const sudoUserEmails = sudoUsers.map(user => user.email)
  if (sudoUserEmails.includes(session.user.email)) return true
  if (session.user.id !== site.userId) throw new Error('Unauthorized access to site')
  return true
}

export const handlers: typeof nextAuthResult.handlers = nextAuthResult.handlers
export const signIn: typeof nextAuthResult.signIn = nextAuthResult.signIn
export const signOut: typeof nextAuthResult.signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth
