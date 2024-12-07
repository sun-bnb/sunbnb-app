import NextAuth, { NextAuthResult } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import FacebookProvider from 'next-auth/providers/facebook'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from '@repo/data/PrismaCient'

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET,
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
    }),
    Credentials({
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" }
      },
      authorize: async (credentials) => {

        console.log('CREDENTIALS', credentials)

        let user = null
 
        // logic to salt and hash password
        const pwHash = null //saltAndHashPassword(credentials.password)
 
        // logic to verify if the user exists
        user = {
          name: 'John Doe',
          email: 'vhalme@gmail.com',
        } //await getUserFromDb(credentials.email, pwHash)

        const email: string = credentials.email as string

        user = await prisma.user.findUnique({ where: { email } })
 
        if (!user) {
          // No user found, so this is their first attempt to login
          // Optionally, this is also the place you could do a user registration
          throw new Error("Invalid credentials.")
        }
        
        // return user object with their profile data
        return user
      },
    })
  ],
  callbacks: {
    async session({ session, token, user }) {
      console.log('SESSION CALLBACK', session, token, user)
      return session
    },
    async signIn({ profile }) {
      console.log('SIGNIN CALLBACK', profile)
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