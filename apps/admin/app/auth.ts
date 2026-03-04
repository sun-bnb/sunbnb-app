import NextAuth, { NextAuthResult } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from '@repo/data/PrismaCient'

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET,
    })
  ],
  callbacks: {
    async session({ session }) {
      return session
    },
    async signIn() {
      return true
    },
    async jwt({ token }) {
      return token
    }
  },
})

export const handlers: typeof nextAuthResult.handlers = nextAuthResult.handlers
export const signIn: typeof nextAuthResult.signIn = nextAuthResult.signIn
export const signOut: typeof nextAuthResult.signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth
