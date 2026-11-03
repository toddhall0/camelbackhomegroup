// Scheduled in netlify.toml. Copies emails from leads out of agents' inboxes into
// the CRM. Anything not from a known lead is ignored and never stored.

const { createClient } = require("@supabase/supabase-js");
const { unwrap, normalizeEmail, logActivity } = require("../lib/crm");
const { isConfigured, getToken, listInbox } = require("../lib/microsoft");

// Rereading a few days is safe, since each email is saved once, and covers any failed runs
const LOOKBACK_MS = 3 * 24 * 3600000;

async function syncMailbox(db, token, agent, since) {
  const emails = await listInbox(token, agent.email, since);
  const senders = [...new Set(emails.map((m) => normalizeEmail(m.from && m.from.emailAddress && m.from.emailAddress.address)).filter(Boolean))];
  if (!senders.length) return 0;

  const leads = unwrap(await db.from("leads").select("id, email").in("email", senders));
  const leadByEmail = new Map(leads.map((l) => [l.email, l]));
  let saved = 0;

  for (const email of emails) {
    const from = normalizeEmail(email.from && email.from.emailAddress && email.from.emailAddress.address);
    const lead = leadByEmail.get(from);
    if (!lead || !email.internetMessageId) continue;

    const inserted = unwrap(
      await db
        .from("messages")
        .upsert(
          {
            lead_id: lead.id,
            agent_id: agent.id,
            channel: "email",
            direction: "inbound",
            status: "received",
            from_address: from,
            to_address: agent.email,
            subject: email.subject || "(no subject)",
            body: (email.uniqueBody && email.uniqueBody.content || "").trim() || "(empty message)",
            provider_id: email.internetMessageId,
            created_at: email.receivedDateTime,
          },
          { onConflict: "channel,provider_id", ignoreDuplicates: true }
        )
        .select("id")
    );
    if (!inserted.length) continue;

    await logActivity(db, lead.id, "email_received", { message: email.subject || "(no subject)", created_at: email.receivedDateTime });
    unwrap(await db.from("leads").update({ last_active_at: email.receivedDateTime }).eq("id", lead.id));
    saved++;
  }
  return saved;
}

exports.handler = async () => {
  if (!isConfigured()) return { statusCode: 200, body: "Email isn't connected yet" };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const token = await getToken();
  const agents = unwrap(await db.from("agents").select("id, email").eq("is_active", true));

  let saved = 0;
  // One bad mailbox shouldn't stop the others
  for (const agent of agents) {
    try {
      saved += await syncMailbox(db, token, agent, since);
    } catch (err) {
      console.error("email sync failed for agent", agent.id, err.message);
    }
  }
  return { statusCode: 200, body: JSON.stringify({ saved }) };
};
