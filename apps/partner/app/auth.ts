import NextAuth, { NextAuthResult } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const nextAuthResult: NextAuthResult = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET,
    })
  ]
})

export const handlers = nextAuthResult.handlers
export const signIn = nextAuthResult.signIn
export const signOut = nextAuthResult.signOut
export const auth: any = nextAuthResult.auth