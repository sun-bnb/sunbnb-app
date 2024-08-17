import NextAuth, { NextAuthResult } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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
    async session({ session, token, user }) {
      // console.log('SESSION CALLBACK', session, token, user)
      return session
    },
    async signIn({ profile }) {
      // console.log('SIGNIN CALLBACK', profile)
      return true
    },
    async jwt({ token, user }) {
      console.log('JWT CALLBACK', token, user)
      return token;
    }
  },
  pages: {
    newUser: '/new-user'
  }
})

export const handlers = nextAuthResult.handlers
export const signIn = nextAuthResult.signIn
export const signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth