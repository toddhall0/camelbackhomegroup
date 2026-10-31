-- Newer Supabase projects may not grant API roles access to new tables
-- automatically, so state it here. RLS still decides which rows `authenticated`
-- can reach. `leads` is left out for `authenticated`: its column grants in the
-- schema migration keep password_hash out of the dashboard.

GRANT USAGE ON SCHEMA public TO service_role, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  agents, activities, favorites, notes, tasks, chat_conversations, chat_messages,
  email_templates, drip_campaigns, drip_steps, drip_enrollments, email_log,
  saved_searches, scoring_rules
TO authenticated;

NOTIFY pgrst, 'reload schema';
