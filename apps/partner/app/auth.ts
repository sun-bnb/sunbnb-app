import NextAuth, { NextAuthResult, CredentialsSignin } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import FacebookProvider from 'next-auth/providers/facebook'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from '@repo/data/PrismaCient'
import { validateOrCreateUser } from '@repo/data/auth'
import { SiteProps } from '@/types/shared'

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET!,
      // SECURITY NOTE: allows OAuth sign-in to link with existing credentials
      // accounts sharing the same email. Required for smooth UX where accounts
      // are auto-created. Risk: attacker with OAuth control of an email could
      // access a credentials-only account. Mitigated by Google/Facebook's own
      // account security. TODO: add password verification on first link.
      allowDangerousEmailAccountLinking: true,
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      allowDangerousEmailAccountLinking: true, // see note on GoogleProvider
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
  ],
  callbacks: {
    async session({ session, token }) {
      session.user.id = token.id as string
      return session
    },
    async signIn({ credentials }) {
      const loginError = credentials?.loginError
      if (loginError) {
        return `/api/auth/signin?error=${loginError}`
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
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
