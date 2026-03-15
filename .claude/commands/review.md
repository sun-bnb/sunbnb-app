# /review — Pre-push code review

Review staged/unstaged changes against project rules and conventions before pushing.

## Usage
- `/review` — review all uncommitted changes
- `/review --branch` — review all commits on current branch vs main
- `/review <file>` — review a specific file's changes

## Instructions

You are a code reviewer for a Sunbnb Turborepo monorepo. Your job is to catch bugs, security issues, and convention violations BEFORE code gets pushed. Apply the critical, requirements-driven approach — don't assume the code is correct.

Parse the user's argument: $ARGUMENTS

### Step 1: Gather the diff

- No args or empty: `git diff` + `git diff --cached` (all uncommitted changes)
- `--branch`: `git log main..HEAD --oneline` to list commits, then `git diff main...HEAD` for the full diff
- Specific file: `git diff <file>` + `git diff --cached <file>`

If there are no changes, tell the user and stop.

### Step 2: Identify affected areas

From the diff, determine which apps/packages are affected and read the relevant source files (not just the diff — you need context).

### Step 3: Check against project rules

Apply these checks in order of severity:

**CRITICAL — Security & Data Integrity:**
- [ ] Auth guards present on all server actions and API routes (`requireSiteOwner`, `verifySiteOwnership`, `auth()`, `getRequestIdentity`)
- [ ] No client-supplied prices used in calculations — prices must come from DB
- [ ] No client-supplied userId trusted — always derive from session
- [ ] Ownership verification before returning or mutating user-scoped resources
- [ ] No SQL injection in raw queries (parameterized only)
- [ ] Stripe/Mollie webhook signature verification present
- [ ] Demo payment check (`isDemoPayment()`) before calling real payment APIs
- [ ] Password reset tokens are hashed before storage
- [ ] Rate limiting on auth endpoints

**HIGH — Correctness:**
- [ ] Server actions return `{ status: 'ok' | 'error', errors?: string[] }` consistently
- [ ] Status transitions follow the documented state machines (reservation, order, rental)
- [ ] Date validation (from < to) on reservation/rental creation
- [ ] Availability checks before creating reservations/rentals
- [ ] Invoice creation is idempotent (check before create)
- [ ] VAT calculation uses reverse formula: `base = round(gross / (1 + rate/100))`
- [ ] Service fees use three-tier cascade (site → partnerAccount → settings)
- [ ] `paymentAmount` is set alongside `totalPrice` on bookings

**MEDIUM — Conventions & Quality:**
- [ ] Status constants imported from `@repo/data/reservation-status` (not hardcoded strings)
- [ ] Prisma models only defined in `packages/data` (not in apps)
- [ ] Input validation for enum fields (using validators from `lib/validation.ts`)
- [ ] String fields truncated to limits (guestName: 200, notes: 500)
- [ ] `revalidatePath` called after mutations
- [ ] No `console.log` left in production code (use `console.error` for errors only)

**LOW — Style:**
- [ ] Consistent naming patterns
- [ ] No unused imports or variables
- [ ] TypeScript types used (not `any` unless necessary)

### Step 4: Run relevant tests

After the review, run tests for affected areas:
- Determine which app(s) changed
- Run unit tests for those apps
- If server actions or DB logic changed, mention integration tests should be run too

### Step 5: Report

Structure your report as:

**Changes reviewed:** (one-line summary of what changed)

**Issues found:**
List each issue with:
- Severity (CRITICAL / HIGH / MEDIUM / LOW)
- File and line number
- What's wrong and what the fix should be

**Tests:** Pass/fail summary

**Verdict:** One of:
- "Ready to push" — no issues found
- "Fix before pushing" — issues found with specific fixes listed
- "Needs discussion" — architectural concerns that need alignment

If no issues found, keep it brief: "Changes reviewed. No issues. Tests pass. Ready to push."
