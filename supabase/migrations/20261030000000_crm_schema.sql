-- Camelback Home Group CRM schema (see CRM-DEVELOPMENT-GUIDE.md)
--
-- Additions to the guide's schema:
--   leads.email_opt_out   the guide's "Email Unsubscribe" note asks for this
--   leads.short_summary   keeps the browsing summary lead-capture.js sends with `update`
--   triggers              keep the denormalized lead counters correct under concurrent writes
--   assign_lead_round_robin()  auto-assignment for the `create` action

-- ============================================================
-- Core tables
-- ============================================================

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'paralegal')),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,

  source TEXT NOT NULL DEFAULT 'website',  -- 'website', 'chat', 'property_inquiry', 'referral', 'manual'
  source_detail TEXT,
  landing_page TEXT,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'showing', 'under_contract', 'closed_won', 'closed_lost', 'nurture')),
  lead_type TEXT DEFAULT 'buyer' CHECK (lead_type IN ('buyer', 'seller', 'both', 'investor')),

  assigned_agent_id UUID REFERENCES agents(id),

  score INTEGER DEFAULT 0,
  score_updated_at TIMESTAMPTZ,

  preferred_cities TEXT[],
  min_price INTEGER,
  max_price INTEGER,
  min_beds INTEGER,
  min_baths INTEGER,
  preferred_property_types TEXT[],

  total_page_views INTEGER DEFAULT 0,
  total_listing_views INTEGER DEFAULT 0,
  total_favorites INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  short_summary TEXT,

  email_opt_out BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'lead_created', 'page_view', 'listing_view', 'favorite_add', 'favorite_remove',
                       -- 'form_submit', 'property_inquiry', 'chat_message', 'email_sent', 'email_opened',
                       -- 'email_clicked', 'call_logged', 'note', 'status_change', 'site_visit'
  property_id TEXT,       -- SimplyRETS mlsId, for API lookups
  mls_number TEXT,        -- ARMLS number (SimplyRETS listingId), for display
  property_address TEXT,
  property_price INTEGER,
  property_city TEXT,
  page_url TEXT,
  message TEXT,
  metadata JSONB,
  created_by UUID REFERENCES agents(id),  -- NULL if automated or lead-initiated
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,  -- SimplyRETS mlsId
  mls_number TEXT,
  property_address TEXT,
  property_price INTEGER,
  property_city TEXT,
  saved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (lead_id, property_id)
);

CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  session_id TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  summary TEXT
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Email and automation tables
-- ============================================================

CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  category TEXT,  -- 'welcome', 'listing_alert', 'drip', 'manual', 'market_update'
  variables TEXT[],
  created_by UUID REFERENCES agents(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drip_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,  -- 'lead_created', 'status_change', 'tag_added', 'manual'
  trigger_value TEXT,          -- e.g. 'buyer' for lead_created, 'qualified' for status_change
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drip_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES drip_campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  template_id UUID REFERENCES email_templates(id),
  subject_override TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES drip_campaigns(id) ON DELETE CASCADE,
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_send_at TIMESTAMPTZ,
  UNIQUE (lead_id, campaign_id)
);

CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  template_id UUID REFERENCES email_templates(id),
  campaign_id UUID REFERENCES drip_campaigns(id),
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'sent',  -- 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
  resend_id TEXT,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT,
  criteria JSONB NOT NULL,
  alert_frequency TEXT DEFAULT 'daily' CHECK (alert_frequency IN ('instant', 'daily', 'weekly', 'none')),
  last_alerted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL UNIQUE,  -- matches activities.type
  points INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Values from the guide's "Lead Scoring System" table, plus form_submit from its schema comment
INSERT INTO scoring_rules (event_type, points, description) VALUES
  ('page_view',        1,  'Basic engagement'),
  ('listing_view',     3,  'Active searching'),
  ('favorite_add',     5,  'Strong interest signal'),
  ('form_submit',      10, 'Submitted a website form'),
  ('property_inquiry', 15, 'High intent'),
  ('chat_started',     2,  'Engaged with AI'),
  ('chat_message',     1,  'Continued engagement'),
  ('email_opened',     2,  'Responsive to outreach'),
  ('email_clicked',    5,  'Very responsive'),
  ('city_interest',    3,  'Clear preference forming'),
  ('return_visit',     5,  'Coming back');

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_agent ON leads(assigned_agent_id, created_at DESC);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_last_active ON leads(last_active_at DESC);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_phone ON leads(phone);

CREATE INDEX idx_activities_lead ON activities(lead_id, created_at DESC);
CREATE INDEX idx_activities_type ON activities(type);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_property ON activities(property_id);

CREATE INDEX idx_favorites_lead ON favorites(lead_id);
CREATE INDEX idx_notes_lead ON notes(lead_id, created_at DESC);
CREATE INDEX idx_tasks_agent_due ON tasks(agent_id, due_date) WHERE status = 'pending';
CREATE INDEX idx_tasks_lead ON tasks(lead_id);
CREATE INDEX idx_chat_conversations_lead ON chat_conversations(lead_id);
CREATE INDEX idx_chat_conversations_session ON chat_conversations(session_id);
CREATE INDEX idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_drip_steps_campaign ON drip_steps(campaign_id, step_order);
CREATE INDEX idx_drip_enrollments_due ON drip_enrollments(next_send_at) WHERE status = 'active';
CREATE INDEX idx_email_log_lead ON email_log(lead_id, sent_at DESC);
CREATE INDEX idx_email_log_resend ON email_log(resend_id);
CREATE INDEX idx_saved_searches_lead ON saved_searches(lead_id);

-- ============================================================
-- Triggers
-- ============================================================

CREATE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER email_templates_set_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keeps engagement counters current for activity the lead generated
CREATE FUNCTION bump_lead_engagement() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS NULL
     AND NEW.type IN ('page_view', 'site_visit', 'listing_view', 'favorite_add', 'favorite_remove',
                      'form_submit', 'property_inquiry', 'chat_message') THEN
    UPDATE leads SET
      total_page_views = total_page_views + (NEW.type IN ('page_view', 'site_visit'))::int,
      total_listing_views = total_listing_views + (NEW.type = 'listing_view')::int,
      last_active_at = now()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER activities_bump_engagement AFTER INSERT ON activities
  FOR EACH ROW EXECUTE FUNCTION bump_lead_engagement();

CREATE FUNCTION sync_lead_favorite_count() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE leads SET total_favorites = total_favorites + 1 WHERE id = NEW.lead_id;
  ELSE
    UPDATE leads SET total_favorites = GREATEST(total_favorites - 1, 0) WHERE id = OLD.lead_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER favorites_sync_count AFTER INSERT OR DELETE ON favorites
  FOR EACH ROW EXECUTE FUNCTION sync_lead_favorite_count();

-- ============================================================
-- Lead assignment
-- ============================================================

-- Gives the lead to the active agent who has gone longest without one.
-- Paralegals support transactions and do not receive leads.
CREATE FUNCTION assign_lead_round_robin(p_lead_id UUID) RETURNS UUID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  next_agent UUID;
BEGIN
  -- Serialize so simultaneous signups cannot pick the same agent
  PERFORM pg_advisory_xact_lock(hashtext('assign_lead_round_robin'));

  SELECT a.id INTO next_agent
  FROM agents a
  LEFT JOIN leads l ON l.assigned_agent_id = a.id
  WHERE a.is_active AND a.role IN ('admin', 'agent')
  GROUP BY a.id, a.created_at
  ORDER BY max(l.created_at) ASC NULLS FIRST, a.created_at ASC
  LIMIT 1;

  IF next_agent IS NOT NULL THEN
    UPDATE leads SET assigned_agent_id = next_agent
    WHERE id = p_lead_id AND assigned_agent_id IS NULL;
  END IF;

  RETURN next_agent;
END;
$$;

-- Server-side only; Postgres grants EXECUTE to PUBLIC by default
REVOKE EXECUTE ON FUNCTION assign_lead_round_robin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_lead_round_robin(UUID) TO service_role;

-- ============================================================
-- Row Level Security
--
-- Netlify functions use the service role, which bypasses RLS. The dashboard
-- uses the `authenticated` role. `anon` has no policies, so the public anon
-- key can read and write nothing.
-- ============================================================

-- SECURITY DEFINER so policies on `agents` can read `agents` without recursing
CREATE FUNCTION current_agent_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM agents WHERE auth_id = auth.uid() AND is_active = true
$$;

CREATE FUNCTION current_agent_is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM agents WHERE auth_id = auth.uid() AND is_active = true AND role = 'admin')
$$;

REVOKE EXECUTE ON FUNCTION current_agent_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION current_agent_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_agent_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_agent_is_admin() TO authenticated, service_role;

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_rules ENABLE ROW LEVEL SECURITY;

-- agents: the team can see each other; admins manage the team
CREATE POLICY "Agents can view agents" ON agents
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Admins can manage agents" ON agents
  FOR ALL TO authenticated USING (current_agent_is_admin()) WITH CHECK (current_agent_is_admin());

-- leads: team-wide read; write if assigned, or admin
CREATE POLICY "Agents can view all leads" ON leads
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can create leads" ON leads
  FOR INSERT TO authenticated WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can update assigned leads" ON leads
  FOR UPDATE TO authenticated
  USING (current_agent_is_admin() OR assigned_agent_id = current_agent_id())
  WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Admins can delete leads" ON leads
  FOR DELETE TO authenticated USING (current_agent_is_admin());

-- password_hash is for website login in lead.js only. Column grants keep it out
-- of the dashboard, so dashboard queries must name their columns on `leads`
-- rather than select('*').
REVOKE ALL ON leads FROM anon, authenticated;
GRANT SELECT (id, first_name, last_name, email, phone, source, source_detail, landing_page, status,
              lead_type, assigned_agent_id, score, score_updated_at, preferred_cities, min_price,
              max_price, min_beds, min_baths, preferred_property_types, total_page_views,
              total_listing_views, total_favorites, last_active_at, short_summary, email_opt_out,
              tags, created_at, updated_at)
  ON leads TO authenticated;
GRANT INSERT (first_name, last_name, email, phone, source, source_detail, status, lead_type,
              assigned_agent_id, preferred_cities, min_price, max_price, min_beds, min_baths,
              preferred_property_types, email_opt_out, tags)
  ON leads TO authenticated;
GRANT UPDATE (first_name, last_name, email, phone, source, source_detail, status, lead_type,
              assigned_agent_id, preferred_cities, min_price, max_price, min_beds, min_baths,
              preferred_property_types, email_opt_out, tags)
  ON leads TO authenticated;
GRANT DELETE ON leads TO authenticated;

-- activities: team-wide read; agents log their own and may edit their own notes
CREATE POLICY "Agents can view activities" ON activities
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can log activities" ON activities
  FOR INSERT TO authenticated WITH CHECK (created_by = current_agent_id());
CREATE POLICY "Agents can edit their own notes" ON activities
  FOR UPDATE TO authenticated
  USING (type = 'note' AND created_by = current_agent_id())
  WITH CHECK (type = 'note' AND created_by = current_agent_id());
CREATE POLICY "Admins can delete activities" ON activities
  FOR DELETE TO authenticated USING (current_agent_is_admin());

-- favorites: written by the website through lead.js; read-only in the dashboard
CREATE POLICY "Agents can view favorites" ON favorites
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);

-- notes
CREATE POLICY "Agents can view notes" ON notes
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can add notes" ON notes
  FOR INSERT TO authenticated WITH CHECK (agent_id = current_agent_id());
CREATE POLICY "Agents can edit their own notes" ON notes
  FOR UPDATE TO authenticated
  USING (agent_id = current_agent_id() OR current_agent_is_admin())
  WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can delete their own notes" ON notes
  FOR DELETE TO authenticated USING (agent_id = current_agent_id() OR current_agent_is_admin());

-- tasks
CREATE POLICY "Agents can view tasks" ON tasks
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can create tasks" ON tasks
  FOR INSERT TO authenticated WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can update their own tasks" ON tasks
  FOR UPDATE TO authenticated
  USING (agent_id = current_agent_id() OR current_agent_is_admin())
  WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can delete their own tasks" ON tasks
  FOR DELETE TO authenticated USING (agent_id = current_agent_id() OR current_agent_is_admin());

-- chat: written by chat.js; read-only in the dashboard
CREATE POLICY "Agents can view conversations" ON chat_conversations
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can view chat messages" ON chat_messages
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);

-- email setup: any active agent can work with templates, campaigns and enrollments
CREATE POLICY "Agents can manage templates" ON email_templates
  FOR ALL TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can manage campaigns" ON drip_campaigns
  FOR ALL TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can manage campaign steps" ON drip_steps
  FOR ALL TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can manage enrollments" ON drip_enrollments
  FOR ALL TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can manage saved searches" ON saved_searches
  FOR ALL TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);

-- email_log: written by server functions
CREATE POLICY "Agents can view email log" ON email_log
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);

-- scoring_rules
CREATE POLICY "Agents can view scoring rules" ON scoring_rules
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Admins can manage scoring rules" ON scoring_rules
  FOR ALL TO authenticated USING (current_agent_is_admin()) WITH CHECK (current_agent_is_admin());
