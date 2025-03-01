import NextAuth, { NextAuthResult } from 'next-auth'
import { hash, compare } from 'bcryptjs'
import GoogleProvider from 'next-auth/providers/google'
import FacebookProvider from 'next-auth/providers/facebook'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from '@repo/data/PrismaCient'

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt'
  },
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

        const email: string = credentials.email as string
        const password: string = credentials.password as string

        let user = await prisma.user.findUnique({ where: { email } })

        if (!user) {
          const pwHash = await hash(password, 12)
          console.log('PW HASH', pwHash)
          user = await prisma.user.create({
            data: {
              email,
              password: pwHash
            }
          })
        }

        if (!user.password) {
          throw new Error('User has no password set.')
        }

        const isValid = await compare(password, user.password)

        if (!isValid) {
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
      session.user.id = token.id as string

      return session
    },
    async signIn({ profile }) {

      console.log('SIGNIN CALLBACK', profile)

      const email = profile?.email

      if (!email) {
        return false
      }

      const user = await prisma.user.findUnique({ where: { email } })
      
      console.log('USER', user)

      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      console.log('JWT Callback Token:', token, user); // Debug JWT
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