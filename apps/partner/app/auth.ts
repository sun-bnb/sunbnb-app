import NextAuth, { NextAuthResult } from 'next-auth'
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
  if (!(session.user.id !== site.userId)) throw new Error('Unauthorized access to site')
  return true
}

export const handlers: typeof nextAuthResult.handlers = nextAuthResult.handlers
export const signIn: typeof nextAuthResult.signIn = nextAuthResult.signIn
export const signOut: typeof nextAuthResult.signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth
