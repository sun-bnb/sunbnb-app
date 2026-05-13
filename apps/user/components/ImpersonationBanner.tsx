/**
 * Persistent top-of-page banner shown when the current session was created
 * via admin impersonation. Pure presentational — the layout decides whether
 * to render it based on `session.user.impersonating`.
 */
export default function ImpersonationBanner({ email }: { email: string | null | undefined }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-10 bg-amber-500 text-amber-950 text-sm font-medium px-4 flex items-center justify-between gap-4 shadow-md"
      role="status"
    >
      <span className="truncate min-w-0">
        ⚠️ Signed in as <strong>{email ?? 'user'}</strong> via admin impersonation
      </span>
      <a
        href="/api/auth/end-impersonation"
        className="underline hover:no-underline whitespace-nowrap flex-shrink-0"
      >
        Exit impersonation →
      </a>
    </div>
  )
}
