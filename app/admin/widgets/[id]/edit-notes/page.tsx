import { redirect } from 'next/navigation';
import { getRequiredUserId } from '@/lib/session';

/**
 * Legacy redirect.
 *
 * `/admin/widgets/[id]/edit-notes` used to be the QR-coded editor for the
 * `notes` widget. Now that the platform has a generic per-widget config
 * editor driven by `manifest.config_schema`, every widget (including
 * `notes`) lands on `/admin/widgets/[id]/edit-config`. The legacy URL is
 * preserved as a server-side redirect so any QR codes minted before the
 * migration still resolve — the redirect is a Next.js redirect (server
 * component), not a meta refresh or a client-side router push, so a
 * phone that scans the QR ends up on the new path on the very first
 * request without rendering the old shell.
 *
 * We resolve the session *before* redirecting so an unauthenticated
 * scan can short-circuit to /signin instead of looping: the target page
 * also calls `getRequiredUserId()` and redirects to /signin, so the
 * double-resolve here is intentional (we want the unauth case to
 * resolve to /signin directly, not /edit-config → /signin).
 */
export const dynamic = 'force-dynamic';

export default async function EditNotesRedirect({ params }: { params: Promise<{ id: string }> }) {
  try {
    await getRequiredUserId();
  } catch {
    redirect('/signin');
  }
  const { id } = await params;
  redirect(`/admin/widgets/${encodeURIComponent(id)}/edit-config`);
}