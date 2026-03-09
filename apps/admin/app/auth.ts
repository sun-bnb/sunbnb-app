import NextAuth, { NextAuthResult } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import FacebookProvider from 'next-auth/providers/facebook'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from '@repo/data/PrismaCient'
import { validateOrCreateUser } from '@repo/data/auth'

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
      // SECURITY NOTE: see partner/app/auth.ts for explanation
      allowDangerousEmailAccountLinking: true,
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      allowDangerousEmailAccountLinking: true,
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
        return await validateOrCreateUser(email, password, credentials)
      },
    }),
  ],
  pages: {
    signIn: '/sign-in',
  },
  callbacks: {
    async session({ session, token }) {
      session.user.id = token.id as string
      return session
    },
    async signIn({ credentials, profile, user }) {
      const loginError = credentials?.loginError
      if (loginError) {
        return `/api/auth/signin?error=${loginError}`
      }
      const email = profile?.email || user?.email
      if (!email) return false

      // Block sign-in for emails not in the admin user list
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: email.toLowerCase() },
      })
      if (!adminUser) {
        return '/api/auth/signin?error=AccessDenied'
      }

      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (!existingUser) {
        await prisma.user.create({
          data: { email, name: user?.name, image: user?.image },
        })
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
})

export const handlers: typeof nextAuthResult.handlers = nextAuthResult.handlers
export const signIn: typeof nextAuthResult.signIn = nextAuthResult.signIn
export const signOut: typeof nextAuthResult.signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth
