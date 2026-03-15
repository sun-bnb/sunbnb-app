# Auth Rules

- Both apps use `auth.ts` at app root with NextAuth v5 (JWT strategy).
- Partner app: Google OAuth only. Use `requireSiteOwner()` or `authorizeSite()` for all site mutations — checks `session.user.id === site.userId`. Sudo users bypass ownership checks.
- User app: Google + Facebook + Credentials (email/password with bcrypt). Anonymous support via `anonId` (UUID in localStorage).
- Always verify ownership before returning or mutating user-scoped resources (reservations, orders, rental bookings). Use `verifyOwnership(identity, entity)` in API routes and manual checks in server actions.
- Anonymous users pass `anonId` via query param or request body. Identity extraction: `getRequestIdentity(request, bodyAnonId?)` returns `{ userId?, anonId? }`.
- Password reset tokens are SHA-256 hashed before storage. Never store plaintext tokens. Rate-limit reset requests (3/hour per email).
- `sudo` field on User model grants platform admin access across all apps.
