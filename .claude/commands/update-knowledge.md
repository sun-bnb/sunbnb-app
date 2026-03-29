# /update-knowledge — Update project documentation

Review recent changes and update CLAUDE.md, ARCHITECTURE.md, and SECURITY.md files to reflect current state of the codebase.

## Usage
- `/update-knowledge` — update all documentation files across the entire project
- `/update-knowledge user` — update apps/user/CLAUDE.md only
- `/update-knowledge partner` — update apps/partner/CLAUDE.md only
- `/update-knowledge admin` — update apps/admin/CLAUDE.md only
- `/update-knowledge data` — update packages/data/CLAUDE.md only
- `/update-knowledge root` — update root CLAUDE.md, ARCHITECTURE.md, SECURITY.md only

## Instructions

Parse the argument: $ARGUMENTS

### Step 1: Determine scope

Map argument to target files:

| Argument | Files to update |
|---|---|
| (none) | ALL: root CLAUDE.md, ARCHITECTURE.md, SECURITY.md, apps/*/CLAUDE.md, packages/data/CLAUDE.md |
| `user` | apps/user/CLAUDE.md |
| `partner` | apps/partner/CLAUDE.md |
| `admin` | apps/admin/CLAUDE.md |
| `data` | packages/data/CLAUDE.md |
| `root` | CLAUDE.md, ARCHITECTURE.md, SECURITY.md |

### Step 2: Understand what changed

Run these to get context on recent changes:
```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
git diff main...HEAD
```

If on main branch with no upstream divergence, use:
```bash
git log -10 --oneline
git diff HEAD~5...HEAD
```

### Step 3: Update each target file

For each file in scope:

**If the file exists:**
1. Read the current content
2. Compare against recent changes — identify anything stale, missing, or incorrect
3. Edit the file to reflect current reality

**If the file does not exist (ARCHITECTURE.md, SECURITY.md):**
Create it from scratch using the guidelines below.

### Step 4: What to document (and what not to)

**DO document:**
- Architectural patterns and how components interact
- Key conventions and rules (auth guards, pricing rules, state machines)
- Non-obvious behaviours and gotchas
- Security-critical patterns that must not be regressed
- New features and how they work at a system level

**DO NOT document:**
- Line-by-line change summaries (that's what git log is for)
- Temporary state or work-in-progress
- Things already obvious from reading the code
- Speculative future plans

---

## ARCHITECTURE.md structure (create if missing)

Create at repo root. Cover:

```markdown
# Architecture

## Monorepo Structure
- Apps and packages, what each owns, dependency direction
- `packages/data` is the single source of truth for DB access — apps never define Prisma models

## Data Flow
- Server components: fetch via Prisma directly (no API layer)
- Client components: RTK Query for polling/caching, server actions for mutations
- No API layer between server components and DB

## Payment Architecture
- Stripe: partner subscriptions + consumer payments (reservations, orders)
- Mollie for Platforms: marketplace payments (consumer → Sunbnb → venue operator)
- Demo mode: pi_demo_{timestamp} refs, same invoice logic, no real API calls
- Three payment flows: Stripe, Mollie, Demo — always check isDemoPayment() first

## Inventory Map System
- Google Maps via @vis.gl/react-google-maps
- Physical sunbed size: 2.1m — must stay consistent across InventoryMap.tsx, InventoryField.tsx, chair-util.ts, SunbedSelection.tsx
- Parcels: grouped inventory items (item.group > 0). Drag moves entire group via moveParcel() server action
- Group drag: positionOverride prop pattern — sibling markers get position offset during drag

## Mobile Reservation Drawer (user app)
- Fixed bottom panel with peek (minimized) and expanded states
- viewMode ('sunbeds'|'equipment') stored in Redux sitesSlice — drives peek height calculation
- Tab switch dispatches focused: true to open drawer automatically
- Peek height varies by tab: sunbeds = date range only, equipment = +hours/days toggle when hourly pricing available

## Equipment Rentals
- Enabled per-site via features[] array (add "rentals")
- RentalItem has pricePerHour and pricePerDay (both optional, at least one required)
- RentalBooking has durationType ('hours'|'days'), from, to, quantity, totalPrice
- Availability: aggregate booked quantities for overlapping time windows (from < to overlap)
- Categories: surfboard, paddleboard, kayak, pedalboat, snorkel, other

## Settlement System
- Settlement records aggregate monthly payouts per partner
- Lifecycle: DRAFT → CLOSED → APPROVED → PAID (revert: APPROVED→CLOSED, CLOSED→DRAFT)
- Invoice + InvoiceLine generated post-payment via processConfirmedReservation/Order/RentalBooking
- Two invoices per payment: PARTNER (revenue) and PLATFORM (commission)
- Invoice hash chain: SHA-256, each hash includes previous invoice hash
```

---

## SECURITY.md structure (create if missing)

Create at repo root. Cover:

```markdown
# Security

## Auth Model

### Partner App (apps/partner)
- Google OAuth only
- requireSiteOwner(siteId) / verifySiteOwnership(siteId) checks session.user.id === site.userId
- Manage page: token-gated via SecurityToken table. All manage actions accept optional accessKey param.
  accessKey validation: token must exist, not expired, resources includes 'all' or 'manage_site',
  and token.userId must match site.userId
- Sudo users (User.sudo) bypass ownership checks in admin app only — not partner app

### User App (apps/user)
- Google, Facebook, Credentials (bcrypt)
- Anonymous support: anonId UUID in localStorage('sunbnb-anonId') for POS/QR flows
- Identity extraction: getRequestIdentity(request, bodyAnonId?) returns { userId?, anonId? }
- Ownership: verifyOwnership(identity, entity) — checks userId or anonId match

### Admin App (apps/admin)
- Requires sudo: true on User record
- requireSudo() guard on every action

## Payment Security

### Default-deny logic
Use `=== 'paid'` NOT `!== 'unpaid'` when checking if payment is required.
Unknown payment types must NOT bypass payment — fail closed.

### Price trust
Never trust client-supplied prices. Always fetch from DB.
paymentAmount must always be set alongside totalPrice on bookings.

### Webhook verification
- Stripe: verify stripe-signature header via stripe.webhooks.constructEvent()
- Mollie: validate payment ID format (/^tr_[A-Za-z0-9]{1,50}$/)

### Demo payments
Check isDemoPayment(ref) (prefix: pi_demo_) before calling any real Stripe/Mollie API.
Demo payments run the same invoice creation logic but never hit payment providers.

## API Security

### Error responses
API error responses use generic messages — never leak internal details (product IDs, DB errors, Mollie error.detail/field).
Pattern: return generic string like 'Payment could not be processed. Please try again or contact support.'

### Input validation
- redirectUrl origin validated against APP_URL/NEXT_PUBLIC_APP_URL (Mollie)
- placeId regex-validated before Google Places proxy calls
- Entity IDs validated as CUID or UUID v4 via isValidEntityId()
- Enum fields use validators from lib/validation.ts — never hardcode allowed values

### Rate limiting
- Password reset: max 3/hour per email (in-memory sliding window, resets on cold start)
- Auth endpoints: rate-limited via rateLimit() from @repo/data/rate-limit

## Password Reset
- Tokens are SHA-256 hashed before storage — NEVER store plaintext tokens
- Origin validated against ALLOWED_ORIGINS env var
- Password strength: 8+ chars, upper + lower + digit
- Max 3 reset requests/hour per email, previous tokens invalidated on new request
- Token expiry enforced at redemption time

## Reconciliation
- /api/reconcile endpoint: requires RECONCILIATION_SECRET header (returns 503 if unset)
- Safety net for stuck payments — processes any succeeded payments that webhooks missed
```

---

### Step 5: Confirm what was updated

After updating, briefly list:
- Which files were modified or created
- Key changes made to each
- Any content that was intentionally left unchanged and why
