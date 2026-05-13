import NextAuth, { NextAuthResult, CredentialsSignin } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import FacebookProvider from 'next-auth/providers/facebook';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { headers } from 'next/headers';
import prisma from '@repo/data/PrismaCient';
import { validateOrCreateUser } from '@repo/data/auth';
import { consumeImpersonationToken } from '@repo/data/impersonation';

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
    // Admin impersonation. The token is single-use and signed with AUTH_SECRET;
    // consumeImpersonationToken writes the audit row (or throws on replay).
    CredentialsProvider({
      id: 'impersonation',
      name: 'Impersonation',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      authorize: async (raw) => {
        const token = typeof raw?.token === 'string' ? raw.token : null;
        if (!token) return null;
        const h = await headers();
        const ip =
          h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          h.get('x-real-ip') ||
          null;
        const userAgent = h.get('user-agent');
        const consumed = await consumeImpersonationToken(token, {
          expectedApp: 'user',
          ip,
          userAgent,
        });
        const user = await prisma.user.findUnique({
          where: { id: consumed.targetUserId },
        });
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          impersonating: true,
          impersonatorId: consumed.adminId,
          impersonationTokenId: consumed.tokenId,
        } as never;
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
      if (token.impersonating) {
        (session.user as any).impersonating = true;
        (session.user as any).impersonatorId = token.impersonatorId;
        (session.user as any).impersonationTokenId = token.impersonationTokenId;
      }
      return session;
    },

    /**
     * Called whenever a user tries to sign in (OAuth or Credentials).
     * We can redirect if there's a custom error in credentials,
     * or allow sign in to proceed.
     */
    async signIn({ credentials, profile, user, account }) {
      // Impersonation: the token already authorised this handoff; skip the
      // user-creation / email-check branches that run for OAuth/credentials.
      if (account?.provider === 'impersonation') return true;

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
        const u = user as any;
        token.id = u.id;
        token.name = u.name;
        token.email = u.email;
        if (u.impersonating) {
          token.impersonating = true;
          token.impersonatorId = u.impersonatorId;
          token.impersonationTokenId = u.impersonationTokenId;
        }
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
