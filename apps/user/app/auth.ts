import NextAuth, { NextAuthResult, CredentialsSignin } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import FacebookProvider from 'next-auth/providers/facebook';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import prisma from '@repo/data/PrismaCient';
import { validateOrCreateUser } from '@repo/data/auth';

const nextAuthResult: NextAuthResult = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  events: {
    async signIn(_message) {
      // Event handler reserved for audit logging
    },
    async linkAccount(_message) {
      // Event handler reserved for audit logging
    }
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
        // Cast to a type that includes our custom 'loginError' field
        const credentials = rawCredentials as {
          email: string;
          password: string;
          loginError?: string;
        };

        const { email, password } = credentials;
        const user = await validateOrCreateUser(email, password, credentials);
        if (!user) {
          const error = new CredentialsSignin();
          error.code = credentials.loginError || 'CredentialsSignin';
          throw error;
        }
        return user;
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
      // Check if our credentials flow set a custom loginError
      const loginError = credentials?.loginError;
      if (loginError) {
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
    signIn: '/sign-in',
    newUser: '/',
  },
});

// Re-export handlers from NextAuth with explicit annotations to avoid deep inferred types
export const handlers: typeof nextAuthResult.handlers = nextAuthResult.handlers;
export const signIn: typeof nextAuthResult.signIn = nextAuthResult.signIn;
export const signOut: typeof nextAuthResult.signOut = nextAuthResult.signOut;
export const auth: any = nextAuthResult.auth; // (kept 'any' per original code)
