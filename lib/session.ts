import { getServerSession } from 'next-auth';
import { authOptions, requireUserId } from './auth';
import { getUserByShareToken } from './db';

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id;
  return typeof id === 'string' ? id : null;
}

export async function getRequiredUserId(): Promise<string> {
  const id = await getCurrentUserId();
  return requireUserId(id);
}

/**
 * Resolve a user from a share token, if valid. Used by /api/snapshot and
 * /display when there's no session — the share token is the long-lived
 * "give this URL to your Kindle" credential.
 */
export async function getUserIdFromShareToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const u = getUserByShareToken(token);
  return u?.id ?? null;
}
