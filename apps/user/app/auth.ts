import NextAuth, { NextAuthResult } from 'next-auth';
import { hash, compare } from 'bcryptjs';
import GoogleProvider from 'next-auth/providers/google';
import FacebookProvider from 'next-auth/providers/facebook';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import prisma from '@repo/data/PrismaCient';

/**
 * Helper function that checks if a user exists,
 * creates one if necessary, and validates the password.
 */
async function validateOrCreateUser(
  email: string,
  password: string,
  credentials: { loginError?: string }
) {

  console.log('validateOrCreateUser', email, password, credentials)

  let user = await prisma.user.findUnique({ where: { email } });

  // If no user, create one with a hashed password
  if (!user) {
    const hashedPassword = await hash(password, 12)
    user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });
  }

  console.log('USER FOUND', user)

  // If the user has no password, it’s likely an OAuth-only account
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

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  events: {
    async signIn(message) {
      console.log('SIGN IN EVT', message)
    },
    async linkAccount(message) {
      console.log('LINK ACCOUNT EVT', message)
    }
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET!,
      allowDangerousEmailAccountLinking: true
    }),
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      allowDangerousEmailAccountLinking: true
    }),
    CredentialsProvider({
      credentials: {
        email: { label: 'Email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (rawCredentials) => {

        console.log('AUTHORIZE', rawCredentials)

        // Cast to a type that includes our custom 'loginError' field
        const credentials = rawCredentials as {
          email: string;
          password: string;
          loginError?: string;
        };

        const { email, password } = credentials;
        return await validateOrCreateUser(email, password, credentials);
      },
    }),
  ],
  callbacks: {
    /**
     * Attach user ID to the session so it's accessible on the client side.
     */
    async session({ session, token }) {
      // 'user' is typically undefined here if using JWT strategy
      session.user.id = token.id as string;
      return session;
    },

    /**
     * Called whenever a user tries to sign in (OAuth or Credentials).
     * We can redirect if there's a custom error in credentials,
     * or allow sign in to proceed.
     */
    async signIn({ credentials, profile, user }) {

      console.log('Sign in', credentials, profile, user)

      // Check if our credentials flow set a custom loginError
      const loginError = credentials?.loginError;
      if (loginError) {
        console.log('Login error', loginError)
        return `/api/auth/signin?error=${loginError}`;
      }

      // For OAuth providers, ensure we have a valid email
      const email = profile?.email || user?.email;
      if (!email) return false

      // Optional: check if the user exists in DB
      // (You already have 'user', so this might be redundant.)
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (!existingUser) {
        await prisma.user.create({ 
          data: { 
            email,
            name: user?.name,
            image: user?.image
          } 
        })
      }

      return true // Sign in is allowed
    },

    /**
     * The JWT callback runs on sign in and every subsequent request.
     * Attach user fields to the token if needed.
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
  },
  pages: {
    newUser: '/',
    // If you want a custom error/sign-in page:
    // signIn: '/auth/api/signin',
    // error: '/auth/api/signin',
  },
});

// Re-export handlers from NextAuth
export const handlers = nextAuthResult.handlers;
export const signIn = nextAuthResult.signIn;
export const signOut = nextAuthResult.signOut;
export const auth: any = nextAuthResult.auth; // (kept 'any' per original code)