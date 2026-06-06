import type { AuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { upsertUser, getUser } from './db';

/**
 * NextAuth configuration with GitHub OAuth. Each GitHub login creates or
 * updates a row in our `users` table keyed by the GitHub user id (string).
 *
 * Dev mode: if NEXTAUTH_GITHUB_ID / NEXTAUTH_GITHUB_SECRET are not set, the
 * GitHub provider is omitted and we fall back to a Credentials provider
 * that accepts any email. This lets local development work without an OAuth
 * app. Production REQUIRES real GitHub OAuth credentials.
 */

const githubId = process.env.GITHUB_ID || process.env.NEXTAUTH_GITHUB_ID;
const githubSecret = process.env.GITHUB_SECRET || process.env.NEXTAUTH_GITHUB_SECRET;
const hasGithub = !!(githubId && githubSecret);

const providers: any[] = [];

if (hasGithub) {
  providers.push(
    GitHubProvider({
      clientId: githubId!,
      clientSecret: githubSecret!,
      authorization: { params: { scope: 'read:user user:email' } },
    }),
  );
} else if (process.env.ENABLE_DEV_LOGIN === 'true') {
  // Opt-in: dev provider that accepts any email. Set ENABLE_DEV_LOGIN=true in
  // your .env if you want to test locally without setting up GitHub OAuth.
  providers.push(
    CredentialsProvider({
      id: 'dev',
      name: 'Local dev',
      credentials: { email: { label: 'Email', type: 'email' } },
      async authorize(credentials) {
        const email = credentials?.email?.toString().trim().toLowerCase();
        if (!email) return null;
        const id = `local:${email}`;
        const u = upsertUser({ id, email, name: email.split('@')[0], avatar_url: null, share_token: null });
        return { id: u.id, email: u.email, name: u.name, image: u.avatar_url } as any;
      },
    }),
  );
}

export const authOptions: AuthOptions = {
  providers,
  secret: process.env.NEXTAUTH_SECRET || 'dev-secret-please-override-in-prod',
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn({ user, account, profile }: any) {
      // Only GitHub in prod. The dev provider is short-circuited above.
      if (account?.provider === 'github') {
        const id = String(profile?.id ?? user?.id ?? user?.email);
        if (!id) return false;
        upsertUser({
          id,
          email: user.email ?? profile?.email ?? null,
          name: (user.name as string) ?? (profile?.login as string) ?? null,
          avatar_url: (user.image as string) ?? (profile?.avatar_url as string) ?? null,
          share_token: null,
        });
      }
      return true;
    },
    async jwt({ token, account, profile }: any) {
      if (account?.provider === 'github' && profile) {
        token.userId = String(profile.id);
      } else if (token.email && !token.userId) {
        // Dev provider: derive userId from email
        token.userId = `local:${token.email}`;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        (session.user as any).id = token.userId;
      }
      return session;
    },
  },
};

export function isAuthEnabled(): boolean {
  return hasGithub || process.env.NODE_ENV !== 'production';
}

export function requireUserId(userId: string | null | undefined): string {
  if (!userId) throw new Error('UNAUTHORIZED');
  return userId;
}
