// Public Supabase settings for the agent dashboard
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY  (public by design; RLS limits it to logged-in agents)
//
// Never return SUPABASE_SERVICE_ROLE_KEY from here.

exports.handler = async () => {
  const headers = { "Content-Type": "application/json" };
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: "CRM not configured" }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ url, anonKey }) };
};
