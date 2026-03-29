# AI Infrastructure Implementation Plan

## Goal

Build a shared AI infrastructure where developer (Ville) and business partner work from the same knowledge base, with the same tools, through interfaces suited to each role. Cover all aspects of business and product development: coding, research, analytics, messaging, and campaign execution.

## Architecture Overview

```
                    SHARED KNOWLEDGE
                    ┌──────────────┐
                    │   Obsidian   │
                    │    Vault     │
                    │  (synced)    │
                    └──────┬───────┘
                           │
                    SHARED TOOLS (MCP)
          ┌────────────────┼────────────────┐
          │                │                │
     Data layer      External         Action layer
     • Postgres      • Web search     • Resend (email)
     • Stripe        • Weather        • Social APIs
     • Vercel        • Tourism data   • GitHub
     • Prisma
                           │
                    SHARED INTELLIGENCE
                    ┌──────┴───────┐
                    │   .claude/   │
                    │  agents/     │
                    │  commands/   │
                    │  rules/      │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        DEVELOPER                BUSINESS PARTNER
        Claude Code CLI          Claude.ai Team
        (dev + business)         (business focused)
```

---

## Phase 1: Foundation (Week 1)

### 1.1 Create Obsidian vault

Create a shared vault called `sunbnb-brain` with this structure:

```
sunbnb-brain/
├── product/
│   ├── overview.md              # what Sunbnb does, for whom
│   ├── features.md              # each feature, how it works, why it exists
│   ├── roadmap.md               # planned, in progress, shipped
│   └── decisions.md             # architectural and product decisions with rationale
├── business/
│   ├── positioning.md           # value prop, differentiation, messaging
│   ├── pricing.md               # tiers, rationale, competitive pricing
│   ├── competitors.md           # who, strengths, weaknesses, our angle
│   ├── metrics.md               # KPI definitions, targets, actuals
│   └── partnerships.md          # active, prospecting, terms
├── customers/
│   ├── icp.md                   # ideal customer profiles
│   ├── pipeline.md              # deals in progress
│   ├── objections.md            # common pushback and responses
│   └── calls/                   # notes from conversations
├── campaigns/
│   ├── active/                  # running campaigns
│   ├── templates/               # reusable email/social templates
│   └── archive/                 # past campaigns with results
├── research/
│   ├── market/                  # industry trends, TAM/SAM
│   └── seasonal/                # demand patterns, weather correlation
└── internal/
    ├── brand-voice.md           # tone, style, do's and don'ts
    └── processes.md             # how we work, who does what
```

### 1.2 Write foundational docs

Sit down together and write initial content for at least these files:
- `product/overview.md` — what Sunbnb is, the problem it solves, how it works
- `product/features.md` — each feature with a paragraph on how it works (sunbed reservations, equipment rentals hourly/daily, F&B ordering, POS/QR flows, manage page, settlement system)
- `business/positioning.md` — ICP, value prop, differentiators, target geography
- `business/pricing.md` — STARTER/PRO/BUSINESS tiers, what's included, service fee structure
- `business/competitors.md` — competitive landscape
- `internal/brand-voice.md` — tone, style guidelines, do's and don'ts

Even rough first drafts are fine. The vault is only as good as what's in it.

### 1.3 Set up Obsidian Sync

Options (pick one):
- **Obsidian Sync** (€8/mo) — simplest, built-in, end-to-end encrypted
- **iCloud** — free, works if both on macOS/iOS
- **Dropbox/Google Drive** — free, cross-platform

Both machines must see the same vault with changes syncing within seconds.

### 1.4 Connect Obsidian MCP to Claude Code

Add to `.mcp.json` in the Sunbnb repo:
```json
{
  "obsidian": {
    "command": "npx",
    "args": ["-y", "obsidian-mcp"],
    "env": {
      "OBSIDIAN_VAULT_PATH": "/path/to/sunbnb-brain"
    }
  }
}
```

Verify: start Claude Code, ask "What's in the product overview?" — should read from vault.

### 1.5 Set up partner on Claude.ai Team

1. Get Claude.ai Team plan (supports MCP servers)
2. Connect Obsidian MCP to partner's workspace
3. Partner verifies: asks "What's our value proposition?" — should answer from vault

### Phase 1 done when:
- [ ] Vault exists with folder structure
- [ ] Core docs written (at least 6 files above)
- [ ] Sync working between both machines
- [ ] Ville can read vault from Claude Code via MCP
- [ ] Partner can read vault from Claude.ai via MCP

---

## Phase 2: Extend MCP layer (Week 2)

### 2.1 Add web search MCP

For research capabilities (competitive analysis, prospect info, market trends).

Options:
- **Brave Search MCP** — `@anthropic/mcp-server-brave-search`
- **Exa MCP** — better for semantic/research queries

Add to `.mcp.json` and configure for both interfaces.

### 2.2 Add Resend MCP

Already using Resend for transactional emails. Add MCP server for campaign emails:
- Draft emails with vault context (brand voice, product features)
- Send directly from the AI interface
- Both developer and partner can use it

### 2.3 Add GitHub MCP

Connect code work to business context:
- Partner can ask "What shipped this week?" → reads recent PRs/releases
- Developer can link business decisions to code changes
- Release notes generated from PR history + vault context

### 2.4 First business agent: analytics-agent

Create `.claude/agents/analytics-agent.md`:

```yaml
---
name: analytics-agent
description: Business intelligence agent. Use for revenue analysis, booking trends,
  partner metrics, churn risk, and any data-driven business questions. Queries Postgres
  and Stripe, interprets trends, writes reports to Obsidian vault.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
maxTurns: 20
---
```

Agent instructions should include:
- How to query Sunbnb Postgres (key tables: Site, Reservation, RentalBooking, Invoice, PartnerAccount, Settlement)
- How to query Stripe MCP (MRR, subscriptions, churn)
- How to write findings to `research/` in the vault
- Output format: plain language summaries with supporting numbers

### 2.5 Partner validates workflow

Partner tests real queries:
- "How many sites onboarded this month?"
- "What's our booking volume trend over the last 3 months?"
- "Which partners have low reservation counts?"

Iterate on the analytics agent based on what works and what doesn't.

### Phase 2 done when:
- [ ] Web search MCP working on both interfaces
- [ ] Resend MCP connected
- [ ] GitHub MCP connected
- [ ] analytics-agent created and tested
- [ ] Partner successfully ran 3+ real analytics queries

---

## Phase 3: Full agent suite + commands (Week 3)

### 3.1 Create bd-agent

`.claude/agents/bd-agent.md` — business development, market research, partnerships.

Capabilities:
- Research prospects using web search
- Pull ICP and positioning from vault
- Query DB for relevant metrics to support pitches
- Generate tailored pitch angles
- Write findings to vault (`customers/`, `research/`)

Tools: Obsidian, Postgres, Brave Search/Exa

### 3.2 Create content-agent

`.claude/agents/content-agent.md` — marketing copy, campaigns, social media, email.

Capabilities:
- Read brand voice and product features from vault
- Draft social media posts, email campaigns, blog outlines
- Pull recent product changes from GitHub for "what's new" content
- Save drafts to `campaigns/active/` in vault
- Send emails via Resend MCP

Tools: Obsidian, Resend, GitHub

### 3.3 Create business commands

**`.claude/commands/research.md`** — `/research <topic>`
1. Search web for topic
2. Cross-reference with vault (competitors, positioning)
3. Write structured research summary to `research/` in vault

**`.claude/commands/campaign.md`** — `/campaign <channel>`
1. Read brand voice + latest product features from vault
2. Draft campaign copy for specified channel (email, social, blog)
3. Save to `campaigns/active/` in vault
4. Optionally execute via Resend (email) or social MCP

**`.claude/commands/analytics.md`** — `/analytics <question>`
1. Query Postgres + Stripe for relevant data
2. Interpret trends in plain language
3. Write report to `research/` in vault

**`.claude/commands/pitch.md`** — `/pitch <prospect>`
1. Research prospect via web search
2. Pull ICP, positioning, and pricing from vault
3. Generate tailored pitch with specific angles for this prospect
4. Save to `customers/pipeline/` in vault

### 3.4 End-to-end workflow test

Partner runs a complete workflow:
1. `/research beach venue management spain` → vault updated with market insights
2. `/pitch BeachClub Mallorca` → tailored pitch generated
3. `/campaign email` → outreach email drafted from pitch + brand voice
4. Send via Resend

### Phase 3 done when:
- [ ] bd-agent, content-agent created and tested
- [ ] /research, /campaign, /analytics, /pitch commands created
- [ ] Partner completed one full research → pitch → campaign workflow
- [ ] Developer used business agents for product decisions (e.g., feature prioritization based on analytics)

---

## Phase 4: External integrations (Week 4+)

### 4.1 Weather / tourism data MCP

For seasonal demand analysis:
- Correlate booking patterns with weather
- "When should beach clubs in Crete expect peak demand?"
- Feed insights into campaign timing

### 4.2 Social media MCPs

For campaign execution:
- Buffer or Hootsuite MCP for scheduling
- Direct Meta API for Facebook/Instagram
- LinkedIn API for B2B outreach

### 4.3 CRM integration (if needed)

If pipeline grows beyond what Obsidian handles:
- HubSpot MCP or Notion MCP for structured deal tracking
- Syncs with vault for context

### Phase 4 done when:
- [ ] At least one external data source connected (weather or tourism)
- [ ] Social media posting works from AI interface
- [ ] Campaign creation → execution is end-to-end automated

---

## Phase 5: Custom interface (when validated)

### 5.1 Build only if Claude.ai Team isn't enough

If partner's usage outgrows Claude.ai — build a thin web app:
- Next.js (existing stack)
- Claude API with system prompt loaded from vault
- MCP tools connected server-side
- Custom UI for frequent workflows (analytics dashboard, campaign manager)
- Deploy as `business.sunbnb.app` (internal, auth-gated)

### 5.2 This is NOT needed on day one

Only build when:
- Partner uses the system daily
- Specific workflows are proven and repeatable
- Claude.ai Team's limitations are actually blocking work

---

## Ongoing maintenance

### Vault hygiene
- After every meaningful conversation, decision, or discovery — write it down
- Review and prune quarterly
- Move completed campaigns to `archive/`

### Agent + command iteration
- Track which agents/commands are used vs ignored
- Refine prompts based on output quality
- Add new commands when new workflows emerge

### Knowledge bridge
- Developer writes to `product/features.md` after shipping features
- Partner writes to `customers/calls/` after customer conversations
- Neither needs to update the other manually — the vault mediates

---

## Current state (as of 2026-03-26)

### Already have:
- Claude Code set up with dev agents (partner-dev, user-dev, admin-dev, data-dev)
- Dev commands (/review, /test, /migrate, /update-knowledge)
- MCP servers: Postgres, Stripe, Vercel, Prisma
- Knowledge files in .claude/knowledge/
- CLAUDE.md files for all apps and packages
- Partner currently uses ChatGPT web client

### Need to set up:
- Obsidian vault with shared sync
- Obsidian MCP
- Claude.ai Team for business partner
- Business agents (analytics, bd, content)
- Business commands (research, campaign, analytics, pitch)
- Web search MCP (Brave/Exa)
- Resend MCP
- GitHub MCP

### Decision needed:
- Obsidian Sync vs iCloud vs Dropbox for vault sync
- Brave Search vs Exa for web research MCP
- Whether partner needs Claude.ai Team or Max plan for MCP support
