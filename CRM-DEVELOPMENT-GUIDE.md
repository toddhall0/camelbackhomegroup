# Camelback Home Group — Custom CRM Development Guide

## Project Overview

Build a full-featured real estate CRM for Camelback Home Group (CHG), a Phoenix-area brokerage. This CRM replaces Sierra Interactive and integrates directly with the existing CHG marketing website (hosted on Netlify). The CRM serves two audiences: **agents** (who manage leads, tasks, and communications via a dashboard) and **website visitors** (whose browsing activity, favorites, chat conversations, and form submissions feed into the CRM automatically).

### Business Context
- CHG is Phoenix's only brokerage with licensed attorneys and paralegals embedded in every transaction
- Serves the entire Phoenix metro (Scottsdale, Mesa, Chandler, Gilbert, Tempe, Glendale, Peoria, Surprise, Goodyear, Buckeye, Queen Creek, Maricopa, Casa Grande, Apache Junction, Fountain Hills)
- Phone: (480) 203-3039
- The marketing website is at camelbackhomegroup.netlify.app (vanilla HTML/CSS/JS, Netlify hosting)
- MLS listing data comes from SimplyRETS API (api.simplyrets.com, basic auth)

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Database + Auth + Realtime** | Supabase (PostgreSQL) | Free tier generous, scales well, built-in auth, realtime subscriptions, Row Level Security, JS client works in browser |
| **Backend API** | Netlify Functions (Node.js serverless) | Already hosting the marketing site on Netlify, keeps everything in one deploy |
| **Frontend (Dashboard)** | Vanilla HTML/CSS/JS with Supabase JS client | Consistent with the marketing site, no build step, Supabase client handles auth + data |
| **Email** | Resend (resend.com) | Simple API, good deliverability, generous free tier (100 emails/day free, 3000/mo), supports HTML templates |
| **Scheduled Jobs** | Netlify Scheduled Functions (cron) | For drip campaigns, listing alerts, lead score recalculation |
| **AI Chat** | Claude API (Anthropic) via Netlify Function | Already built — Kathy chat bot on the marketing site |
| **Design** | Match existing CHG aesthetic | Colors: #cc624c (terracotta/gold), #1f4e60 (teal/charcoal). Fonts: Cormorant Garamond (serif), Jost (sans). Rounded corners (10-12px cards, 8px inputs, 20px pills). Soft, luxury desert feel. |

### Environment Variables Needed (Netlify)
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  (server-side only, never expose to client)
RESEND_API_KEY=re_...
ANTHROPIC_API_KEY=sk-ant-...
SIMPLYRETS_API_KEY=...
SIMPLYRETS_API_SECRET=...
```

---

## Database Schema (Supabase/PostgreSQL)

### Core Tables

```sql
-- Agents (the CHG team members who use the dashboard)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id),  -- Supabase Auth link
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'agent',  -- 'admin', 'agent', 'paralegal'
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Leads (website visitors who have provided contact info)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,  -- for website login (bcrypt)
  
  -- Source tracking
  source TEXT NOT NULL DEFAULT 'website',  -- 'website', 'chat', 'property_inquiry', 'referral', 'manual'
  source_detail TEXT,  -- e.g. 'Registration Popup', 'Kathy AI Chat', 'Property Detail Page'
  landing_page TEXT,  -- first page they visited
  
  -- Pipeline
  status TEXT NOT NULL DEFAULT 'new',  -- 'new', 'contacted', 'qualified', 'showing', 'under_contract', 'closed_won', 'closed_lost', 'nurture'
  lead_type TEXT DEFAULT 'buyer',  -- 'buyer', 'seller', 'both', 'investor'
  
  -- Assignment
  assigned_agent_id UUID REFERENCES agents(id),
  
  -- Lead scoring (computed)
  score INTEGER DEFAULT 0,
  score_updated_at TIMESTAMPTZ,
  
  -- Preferences (from browsing behavior)
  preferred_cities TEXT[],  -- array of city names
  min_price INTEGER,
  max_price INTEGER,
  min_beds INTEGER,
  min_baths INTEGER,
  preferred_property_types TEXT[],
  
  -- Engagement summary (denormalized for quick access)
  total_page_views INTEGER DEFAULT 0,
  total_listing_views INTEGER DEFAULT 0,
  total_favorites INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  
  -- Metadata
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Activities (every interaction: page views, listing views, favorites, form submissions, etc.)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'page_view', 'listing_view', 'favorite_add', 'favorite_remove', 'form_submit', 'chat_message', 'email_sent', 'email_opened', 'email_clicked', 'call_logged', 'note', 'status_change', 'site_visit'
  
  -- Context (varies by type)
  property_id TEXT,       -- SimplyRETS MLS ID for listing-related activities
  mls_number TEXT,        -- Real ARMLS MLS number
  property_address TEXT,
  property_price INTEGER,
  property_city TEXT,
  page_url TEXT,          -- for page_view / site_visit
  message TEXT,           -- for notes, chat messages, form messages
  metadata JSONB,         -- flexible extra data (email subject, campaign name, etc.)
  
  -- Who did it
  created_by UUID REFERENCES agents(id),  -- NULL if automated or lead-initiated
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_activities_lead ON activities(lead_id, created_at DESC);
CREATE INDEX idx_activities_type ON activities(type);

-- Favorites (lead's saved listings, synced with website)
CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,  -- SimplyRETS MLS ID
  mls_number TEXT,
  property_address TEXT,
  property_price INTEGER,
  property_city TEXT,
  saved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(lead_id, property_id)
);
CREATE INDEX idx_favorites_lead ON favorites(lead_id);

-- Notes (agent notes on leads)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tasks (follow-ups, reminders)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
  status TEXT DEFAULT 'pending',   -- 'pending', 'completed', 'cancelled'
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tasks_agent_due ON tasks(agent_id, due_date) WHERE status = 'pending';

-- Chat conversations (from Kathy AI)
CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  session_id TEXT,  -- browser session identifier
  started_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  summary TEXT  -- AI-generated summary of the conversation
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- 'user', 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Email & Automation Tables

```sql
-- Email templates
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  category TEXT,  -- 'welcome', 'listing_alert', 'drip', 'manual', 'market_update'
  variables TEXT[],  -- e.g. ['{{first_name}}', '{{listing_url}}']
  created_by UUID REFERENCES agents(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Drip campaigns (automated email sequences)
CREATE TABLE drip_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,  -- 'lead_created', 'status_change', 'tag_added', 'manual'
  trigger_value TEXT,          -- e.g. 'qualified' for status_change trigger
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Steps within a drip campaign
CREATE TABLE drip_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES drip_campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,  -- days after previous step (or enrollment)
  delay_hours INTEGER DEFAULT 0,
  template_id UUID REFERENCES email_templates(id),
  subject_override TEXT,  -- override template subject
  is_active BOOLEAN DEFAULT true
);

-- Lead enrollment in drip campaigns
CREATE TABLE drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES drip_campaigns(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',  -- 'active', 'completed', 'paused', 'cancelled'
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_send_at TIMESTAMPTZ,
  UNIQUE(lead_id, campaign_id)
);

-- Email send log
CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  template_id UUID REFERENCES email_templates(id),
  campaign_id UUID REFERENCES drip_campaigns(id),
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'sent',  -- 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
  resend_id TEXT,  -- Resend message ID for tracking
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- Saved searches (for listing alerts)
CREATE TABLE saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT,
  criteria JSONB NOT NULL,  -- {city, minPrice, maxPrice, minBeds, minBaths, propertyTypes, etc.}
  alert_frequency TEXT DEFAULT 'daily',  -- 'instant', 'daily', 'weekly', 'none'
  last_alerted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Lead scoring rules (configurable)
CREATE TABLE scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,   -- matches activities.type
  points INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Default scoring rules (insert on setup)
-- page_view: +1, listing_view: +3, favorite_add: +5, form_submit: +10,
-- chat_message: +2, email_opened: +2, email_clicked: +5, property_inquiry: +15
```

### Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
-- ... etc for all tables

-- Agents can see all leads (team-wide access)
CREATE POLICY "Agents can view all leads" ON leads
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_id = auth.uid() AND is_active = true)
  );

-- Agents can modify leads assigned to them (or admins can modify any)
CREATE POLICY "Agents can update assigned leads" ON leads
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE auth_id = auth.uid()
      AND is_active = true
      AND (role = 'admin' OR id = leads.assigned_agent_id)
    )
  );

-- Service role (serverless functions) bypasses RLS
-- Use SUPABASE_SERVICE_ROLE_KEY in Netlify functions
```

---

## API Endpoints (Netlify Functions)

All functions live in `netlify/functions/`. The marketing website calls these; the dashboard uses the Supabase JS client directly for most operations.

### Existing Functions (to be migrated from Sierra to Supabase)

| Function | Current | Migrated |
|---|---|---|
| `lead.js` | Proxies to Sierra API | Writes directly to Supabase `leads`, `activities`, `favorites` tables |
| `chat.js` | Claude AI chat, captures leads to Sierra | Same Claude chat, writes leads/conversations to Supabase |
| `listings.js` | Fetches from SimplyRETS | No change (SimplyRETS stays) |
| `property.js` | Fetches single listing from SimplyRETS | No change |
| `market-stats.js` | Calculates market stats from SimplyRETS | No change |

### New Functions

| Function | Purpose |
|---|---|
| `crm-auth.js` | Agent login/logout via Supabase Auth |
| `drip-processor.js` | Scheduled function (cron) — processes drip campaign queue, sends emails via Resend |
| `listing-alerts.js` | Scheduled function (cron) — checks saved searches against new listings, sends email alerts |
| `score-calculator.js` | Scheduled function (cron) — recalculates lead scores based on recent activity |
| `email-webhook.js` | Receives Resend webhooks for open/click tracking |
| `lead-assign.js` | Round-robin lead assignment to active agents |

### Migrated `lead.js` Actions

The existing `lead.js` supports these actions (called from `lead-capture.js` on the marketing site). Each must be migrated to write to Supabase instead of Sierra:

| Action | Current (Sierra) | Migrated (Supabase) |
|---|---|---|
| `create` | POST /leads | INSERT into `leads` + `activities` (type: 'lead_created') + auto-assign agent + enroll in welcome drip |
| `update` | PUT /leads/{email} | UPDATE `leads` row |
| `addNote` | POST /leads/{email}/note | INSERT into `activities` (type: 'note') |
| `getLead` | GET /leads/get/{email} | SELECT from `leads` + `favorites` |
| `propertyView` | POST /listings/propertyView/ | INSERT into `activities` (type: 'listing_view') + update lead stats |
| `siteVisit` | POST /leads/{email}/siteVisit | INSERT into `activities` (type: 'site_visit') + update lead stats |
| `saveListing` | POST /savedListings | INSERT into `favorites` + `activities` (type: 'favorite_add') |
| `removeListing` | DELETE /savedListings | DELETE from `favorites` + INSERT into `activities` (type: 'favorite_remove') |

---

## Agent Dashboard (Frontend)

The dashboard is a separate set of HTML pages served from a `/crm/` directory on the same Netlify site. It uses the Supabase JS client for auth and data access.

### Pages

#### 1. Login (`/crm/login.html`)
- Email + password login via Supabase Auth
- CHG branded, same aesthetic as marketing site
- "Forgot password" flow

#### 2. Dashboard Home (`/crm/index.html`)
- Summary cards: New leads today, Active leads, Tasks due today, Emails sent today
- Recent activity feed (last 20 activities across all leads)
- Pipeline summary (count per status stage, visualized as a funnel or bar)
- Upcoming tasks (next 5 due)
- Quick actions: Add lead, Log call, Send email

#### 3. Leads List (`/crm/leads.html`)
- Sortable/filterable table of all leads
- Columns: Name, Email, Phone, Status, Score, Source, Assigned Agent, Last Active, Created
- Filters: Status, Source, Agent, Score range, Date range, Tags
- Search by name/email/phone
- Bulk actions: Assign agent, Change status, Add tag, Enroll in campaign
- Click row to open lead detail

#### 4. Lead Detail (`/crm/lead.html?id=...`)
- **Header**: Name, email, phone, status badge, score badge, assigned agent
- **Quick actions**: Change status (dropdown), Assign agent, Add tag, Log call, Send email, Create task
- **Tabs**:
  - **Activity Timeline**: Chronological feed of all activities (views, favorites, emails, notes, status changes, chat messages). Each entry shows icon + description + timestamp. Agent notes are editable.
  - **Favorites**: Grid of saved listings (pulls property data from SimplyRETS). Each card shows photo, address, price, beds/baths. Link to property page.
  - **Communications**: Emails sent/received, chat transcripts. Show open/click status.
  - **Tasks**: Open and completed tasks for this lead.
  - **Details**: Edit lead info (name, email, phone, type, preferences, tags). Browsing summary (page views, avg price, top cities, etc.).

#### 5. Pipeline Board (`/crm/pipeline.html`)
- Kanban-style board with columns for each status
- Drag-and-drop leads between columns
- Each card shows: Name, score, source, last active date
- Click card to open lead detail

#### 6. Tasks (`/crm/tasks.html`)
- List of all tasks for the logged-in agent (admin sees all)
- Filter: My tasks / All tasks, Status, Priority, Due date
- Calendar view option (month/week)
- Create task (with lead selector, due date, priority)

#### 7. Email Center (`/crm/emails.html`)
- **Compose**: Send one-off email to a lead (pick template or write from scratch)
- **Templates**: Create/edit email templates with variable support
- **Campaigns**: Create/manage drip campaigns (define steps, delays, triggers)
- **Sent Log**: History of all emails with delivery/open/click stats
- **Listing Alerts**: Manage saved search alert configurations

#### 8. Analytics (`/crm/analytics.html`)
- **Lead Sources**: Pie/bar chart of where leads come from
- **Conversion Funnel**: Leads through each pipeline stage
- **Activity Trends**: Line chart of page views, listing views, signups over time
- **Agent Performance**: Leads per agent, response time, conversion rate
- **Top Listings**: Most viewed/favorited properties
- **Email Performance**: Open rates, click rates by campaign/template

#### 9. Settings (`/crm/settings.html`)
- **Team**: Add/edit/deactivate agents, set roles
- **Lead Scoring**: View/edit scoring rules (points per activity type)
- **Lead Assignment**: Configure round-robin rules, assignment preferences
- **Notifications**: Configure which events trigger agent notifications
- **Email Settings**: Default from name/address, unsubscribe handling, signature

### Dashboard Design System

```
Colors (same as marketing site):
  --charcoal: #1f4e60       (primary dark / nav / headings)
  --gold: #cc624c            (CTAs, active states, badges)
  --gold-light: #d97965
  --gold-pale: #f2ddd7
  --cream: #f2f0ec           (backgrounds)
  --cream-dark: #e6e1da
  --text-dark: #162d38
  --text-mid: #3d5a68
  --text-light: #6a8290
  --white: #FFFFFF
  --success: #2d8a5e
  --warning: #d4940a
  --danger: #c0392b

Fonts:
  Headings: Cormorant Garamond (serif)
  Body: Jost (sans-serif)

Components:
  Cards: 12px border-radius, subtle shadow (0 1px 4px rgba(0,0,0,0.06))
  Buttons: 10px border-radius, uppercase, letter-spacing 0.08em
  Inputs: 8px border-radius, cream background, sand border
  Badges/pills: 20px border-radius
  Modal: 16px border-radius
  Nav: Fixed left sidebar on desktop, bottom bar on mobile
```

---

## Lead Scoring System

Points are configurable in the `scoring_rules` table. Default values:

| Activity | Points | Rationale |
|---|---|---|
| Page view | +1 | Basic engagement |
| Listing view | +3 | Active searching |
| Favorite added | +5 | Strong interest signal |
| Property inquiry (form) | +15 | High intent |
| Chat started | +2 | Engaged with AI |
| Chat message sent | +1 | Continued engagement |
| Email opened | +2 | Responsive to outreach |
| Email link clicked | +5 | Very responsive |
| Showed interest in specific city | +3 | Clear preference forming |
| Multiple sessions (return visit) | +5 | Coming back |

**Score tiers** (for dashboard display):
- 0-10: Cold (gray badge)
- 11-30: Warm (blue badge)
- 31-60: Hot (orange badge)
- 61+: On Fire (red badge)

**Score decay**: Subtract 1 point per day of inactivity (floor at 0). Recalculated daily by `score-calculator.js`.

---

## Drip Campaign System

### Default Campaigns

#### 1. New Buyer Welcome (trigger: lead_created, lead_type: buyer)
- **Day 0**: Welcome email — introduce CHG, the legal advantage, link to search
- **Day 2**: "What are you looking for?" — ask about preferences, link to neighborhoods
- **Day 5**: "Featured listings" — pull top 3 listings matching their browsing
- **Day 10**: "The home buying process" — educational content about CHG's process
- **Day 20**: "Still looking?" — check in, offer to connect with an agent
- **Day 35**: "Market update" — current Phoenix market snapshot

#### 2. New Seller Welcome (trigger: lead_created, lead_type: seller)
- **Day 0**: Welcome — introduce CHG's seller services, legal protection
- **Day 3**: "What's your home worth?" — link to valuation page
- **Day 7**: "Preparing your home" — staging tips, pre-listing checklist
- **Day 14**: "Meet your team" — introduce agent + legal team
- **Day 30**: "Ready to list?" — CTA to schedule listing appointment

#### 3. Re-engagement (trigger: manual enrollment or 30 days inactive)
- **Day 0**: "We miss you" — new listings in their preferred area
- **Day 7**: "Market update for [preferred city]"
- **Day 14**: "Open houses this weekend"

### Email Template Variables
```
{{first_name}}        — Lead's first name
{{agent_name}}        — Assigned agent's name
{{agent_phone}}       — Assigned agent's phone
{{listing_url}}       — Link to a property
{{listing_address}}   — Property address
{{listing_price}}     — Formatted price
{{listing_photo}}     — Property photo URL
{{search_url}}        — Link to search page with lead's preferences
{{unsubscribe_url}}   — Unsubscribe link
{{company_phone}}     — (480) 203-3039
```

---

## Listing Alerts System

When a lead saves a search or we infer preferences from their browsing:
1. Store criteria in `saved_searches` table
2. `listing-alerts.js` runs on a schedule (daily at 7am Phoenix time)
3. For each active saved search, query SimplyRETS for matches
4. Compare against previously alerted listings (avoid duplicates)
5. If new matches found, send email with listing cards (photo, price, address, beds/baths, link)
6. Log the email in `email_log`

---

## Marketing Site Integration

### What Changes on the Marketing Site

The marketing site (`index.html`, `neighborhoods.html`, `property.html`, etc.) currently calls `/.netlify/functions/lead` which proxies to Sierra. The migration:

1. **`lead-capture.js`**: Change `pushToCRM()` to call the migrated `lead.js` (same endpoint, but it writes to Supabase instead of Sierra). The API contract stays identical — same actions, same request format. The website code barely changes.

2. **`chat-widget.js`**: The `chat.js` function currently calls Sierra for lead capture. Migrate to Supabase. Chat conversation history should also be saved to the `chat_conversations` and `chat_messages` tables.

3. **Favorites**: Currently stored in localStorage + Sierra's note field. Migrate to the `favorites` table in Supabase. On login, fetch favorites from Supabase instead of parsing them from the lead's note field.

4. **User auth**: Currently email-only (no password). Add optional password support — when a user registers via the popup, hash and store the password. On login, verify against the hash. This is website-visitor auth, separate from agent auth (which uses Supabase Auth).

### What Stays the Same
- `listings.js` — still calls SimplyRETS
- `property.js` — still calls SimplyRETS
- `market-stats.js` — still calls SimplyRETS
- All HTML/CSS/styling on the marketing site
- The lead capture popup flow (3-step modal)
- The Kathy chat widget UI
- Heart/favorite buttons

---

## Scheduled Functions (Cron)

Netlify scheduled functions use the `schedule` export.

| Function | Schedule | Purpose |
|---|---|---|
| `drip-processor.js` | Every 15 minutes | Check `drip_enrollments` where `next_send_at <= now()`, send the next email in sequence |
| `listing-alerts.js` | Daily at 7am Phoenix (14:00 UTC) | Run saved searches, email new matches |
| `score-calculator.js` | Daily at 2am Phoenix (09:00 UTC) | Apply score decay (-1/day inactive), recalculate scores for leads with recent activity |
| `blog-publisher.js` | Weekly Tuesdays 8am Phoenix | (Already exists) Generate and publish a blog post |

---

## Implementation Order

Build in this order — each phase is deployable and testable independently:

### Phase 1: Database + Core API (Week 1)
1. Set up Supabase project, create all tables, enable RLS
2. Migrate `lead.js` to write to Supabase (keep same API contract)
3. Migrate `chat.js` lead capture to Supabase + save chat history
4. Migrate favorites to Supabase `favorites` table
5. Update `lead-capture.js` to use Supabase for favorites restore on login
6. Add password support to website registration/login
7. Test: all existing website functionality works with Supabase backend

### Phase 2: Agent Dashboard — Core (Week 2)
1. Dashboard login page (Supabase Auth)
2. Dashboard layout (sidebar nav, responsive)
3. Dashboard home (summary cards, recent activity)
4. Leads list (table with sort/filter/search)
5. Lead detail page (header, activity timeline, favorites tab, details tab)
6. Add/edit lead manually
7. Add notes to leads
8. Change lead status

### Phase 3: Tasks + Pipeline (Week 2-3)
1. Task CRUD (create, edit, complete, delete)
2. Tasks list page with filters
3. Pipeline kanban board with drag-and-drop
4. Task due-date notifications (in dashboard, not email yet)

### Phase 4: Email System (Week 3)
1. Resend integration (send single email)
2. Email template CRUD
3. Compose and send email to a lead
4. Email log with status tracking
5. Resend webhook handler for open/click tracking
6. Basic drip campaign — define campaign, steps, delays
7. Drip enrollment (manual + automatic on lead create)
8. `drip-processor.js` scheduled function

### Phase 5: Listing Alerts + Lead Scoring (Week 4)
1. Saved searches CRUD
2. `listing-alerts.js` scheduled function
3. Lead scoring rules configuration
4. `score-calculator.js` scheduled function
5. Score display on leads list + lead detail

### Phase 6: Analytics + Polish (Week 4-5)
1. Analytics page — lead sources chart, pipeline funnel, activity trends
2. Agent performance metrics
3. Email performance stats
4. Notification system (in-dashboard alerts for new leads, tasks due)
5. Settings page (team management, scoring rules, assignment config)
6. Mobile optimization for dashboard
7. Polish, bug fixes, testing

---

## File Structure

```
camelbackhomegroup/
├── crm/                          # Agent dashboard
│   ├── index.html                # Dashboard home
│   ├── login.html                # Agent login
│   ├── leads.html                # Leads list
│   ├── lead.html                 # Lead detail
│   ├── pipeline.html             # Kanban board
│   ├── tasks.html                # Task management
│   ├── emails.html               # Email center
│   ├── analytics.html            # Analytics/reports
│   ├── settings.html             # System settings
│   ├── crm-app.js                # Shared dashboard logic (auth, nav, supabase client)
│   ├── crm-styles.css            # Dashboard styles
│   └── components/               # Reusable JS components
│       ├── lead-card.js
│       ├── activity-feed.js
│       ├── pipeline-board.js
│       ├── email-composer.js
│       └── charts.js
├── netlify/
│   └── functions/
│       ├── lead.js               # Migrated: Supabase instead of Sierra
│       ├── chat.js               # Migrated: saves to Supabase
│       ├── listings.js           # Unchanged
│       ├── property.js           # Unchanged
│       ├── market-stats.js       # Unchanged
│       ├── crm-auth.js           # Agent auth helper
│       ├── drip-processor.js     # Scheduled: process drip queue
│       ├── listing-alerts.js     # Scheduled: check saved searches
│       ├── score-calculator.js   # Scheduled: recalculate scores
│       ├── email-webhook.js      # Resend open/click webhooks
│       └── lead-assign.js        # Round-robin assignment
├── lead-capture.js               # Marketing site tracking (migrated)
├── chat-widget.js                # Kathy AI chat (migrated)
├── index.html                    # Marketing site homepage
├── neighborhoods.html            # Map + listings
├── property.html                 # Property detail
├── search.html                   # Search page
├── city.html                     # City landing pages
├── blog.html                     # Blog
├── blog-post.html                # Blog post template
├── agents.html                   # Join our team
└── valuation.html                # Home valuation
```

---

## Key Technical Notes

### SimplyRETS MLS IDs vs ARMLS Numbers
- SimplyRETS `mlsId` (e.g. 247121411) is their internal RETS key — use for API lookups
- SimplyRETS `listingId` (e.g. 7080336) is the actual ARMLS MLS number — display to users and store as `mls_number`
- Always store both: `property_id` (mlsId for API calls) and `mls_number` (listingId for display)

### Website User Auth vs Agent Auth
- **Website visitors** log in with email (+ optional password). Their auth is handled by the `lead.js` function checking the `leads` table. Stored in localStorage on the browser.
- **Agents** log in via Supabase Auth on the `/crm/login.html` page. Their session is managed by the Supabase JS client.
- These are completely separate auth systems.

### Realtime Updates (Supabase)
Use Supabase Realtime subscriptions in the dashboard for:
- New lead notifications (INSERT on `leads`)
- Activity feed updates (INSERT on `activities`)
- Task completion notifications (UPDATE on `tasks`)

### Email Unsubscribe
Every marketing email must include an unsubscribe link. Add an `email_opt_out` boolean to the `leads` table. The `drip-processor.js` and `listing-alerts.js` must check this before sending.

### Data Privacy
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client
- Use RLS policies to restrict dashboard access to authenticated agents
- Marketing site uses the anon key (public) — only the lead.js function uses the service role key
- Hash passwords with bcrypt before storing

---

## Testing Checklist

Before considering each phase complete:

- [ ] Website registration creates lead in Supabase
- [ ] Website login restores user data + favorites from Supabase
- [ ] Listing views tracked in activities table
- [ ] Favorites sync between website and Supabase
- [ ] Kathy chat conversations saved to Supabase
- [ ] Agent can log in to dashboard
- [ ] Agent can view lead list with filters
- [ ] Agent can view lead detail with full activity timeline
- [ ] Agent can change lead status (moves through pipeline)
- [ ] Agent can add notes
- [ ] Agent can create/complete tasks
- [ ] Agent can send email to lead
- [ ] Drip campaigns send on schedule
- [ ] Listing alerts send new matches
- [ ] Lead scores update correctly
- [ ] Analytics charts display accurate data
- [ ] All works on mobile
