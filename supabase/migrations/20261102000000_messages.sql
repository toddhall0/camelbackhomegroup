-- One-to-one conversations with leads. `channel` leaves room for texting.
-- Written by server functions only; agents can read everything and mark replies read.

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'received')),
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  error TEXT,
  provider_id TEXT,  -- email: Internet Message-ID, so a sync never saves a reply twice
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, provider_id)
);

CREATE INDEX idx_messages_lead ON messages(lead_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages(created_at DESC) WHERE direction = 'inbound' AND read_at IS NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view messages" ON messages
  FOR SELECT TO authenticated USING (current_agent_id() IS NOT NULL);
CREATE POLICY "Agents can mark messages read" ON messages
  FOR UPDATE TO authenticated USING (current_agent_id() IS NOT NULL) WITH CHECK (current_agent_id() IS NOT NULL);

REVOKE ALL ON messages FROM anon, authenticated;
GRANT SELECT ON messages TO authenticated;
GRANT UPDATE (read_at) ON messages TO authenticated;
GRANT ALL ON messages TO service_role;

NOTIFY pgrst, 'reload schema';
