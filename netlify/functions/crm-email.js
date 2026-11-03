// Sends a one-to-one email to a lead from the signed-in agent's own mailbox
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (server-side only, never expose to client)
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  (see netlify/lib/microsoft.js)

const { createClient } = require("@supabase/supabase-js");
const { unwrap, logActivity } = require("../lib/crm");
const { isConfigured, getToken, sendMail } = require("../lib/microsoft");

const MAX_SUBJECT = 200;
const MAX_BODY = 20000;

const headers = { "Content-Type": "application/json" };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

async function signedInAgent(db, authorization) {
  const token = (authorization || "").replace(/^Bearer /, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data || !data.user) return null;
  return unwrap(
    await db.from("agents").select("id, first_name, last_name, email, phone, role").eq("auth_id", data.user.id).eq("is_active", true).maybeSingle()
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });

  let input;
  try {
    input = JSON.parse(event.body);
  } catch {
    return reply(400, { error: "Invalid request" });
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const agent = await signedInAgent(db, event.headers.authorization);
    if (!agent) return reply(401, { error: "Please sign in again." });

    const subject = String(input.subject || "").trim();
    const text = String(input.body || "").trim();
    if (!input.leadId || !subject || !text) return reply(400, { error: "A subject and message are required." });
    if (subject.length > MAX_SUBJECT || text.length > MAX_BODY) return reply(400, { error: "That message is too long." });

    const lead = unwrap(await db.from("leads").select("id, email, email_opt_out, assigned_agent_id").eq("id", input.leadId).maybeSingle());
    if (!lead) return reply(404, { error: "Lead not found." });
    if (agent.role !== "admin" && lead.assigned_agent_id !== agent.id) {
      return reply(403, { error: "Only the assigned agent or an admin can email this lead." });
    }
    if (!lead.email) return reply(400, { error: "This lead has no email address." });
    if (lead.email_opt_out) return reply(400, { error: "This lead has opted out of email." });
    if (!isConfigured()) return reply(503, { error: "Email isn't connected yet." });

    const signature = [`${agent.first_name} ${agent.last_name}`, "Camelback Home Group", agent.phone].filter(Boolean).join("\n");
    const body = `${text}\n\n--\n${signature}`;
    const message = { lead_id: lead.id, agent_id: agent.id, channel: "email", direction: "outbound", from_address: agent.email, to_address: lead.email, subject, body };

    try {
      await sendMail(await getToken(), { mailbox: agent.email, to: lead.email, subject, body });
    } catch (err) {
      console.error("email send failed:", err.message);
      unwrap(await db.from("messages").insert({ ...message, status: "failed", error: err.message }));
      return reply(502, { error: "The email did not send. It is saved in this lead's messages." });
    }

    // The email has gone out, so a failure from here on must not read as a failed send
    try {
      unwrap(await db.from("messages").insert({ ...message, status: "sent" }));
      await logActivity(db, lead.id, "email_sent", { message: subject, created_by: agent.id });
    } catch (err) {
      console.error("email sent but not recorded:", err.message);
      return reply(200, { success: true, recorded: false });
    }
    return reply(200, { success: true, recorded: true });
  } catch (err) {
    console.error("crm-email failed:", err.message);
    return reply(500, { error: "Something went wrong. Please try again." });
  }
};
