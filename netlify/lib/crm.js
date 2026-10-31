// Shared Supabase CRM helpers for lead.js and chat.js

const LEAD_COLUMNS = "id, first_name, last_name, phone, lead_type";

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase() || null;
}

function leadSource(source) {
  if (/inquiry/i.test(source || "")) return "property_inquiry";
  if (/chat|kathy/i.test(source || "")) return "chat";
  return "website";
}

// Returns the lead for this email, creating it if needed. Tracking actions use
// this too: registered visitors from the Sierra era have no Supabase row yet.
async function ensureLead(db, email, fields = {}) {
  const inserted = unwrap(
    await db.from("leads").upsert({ email, ...fields }, { onConflict: "email", ignoreDuplicates: true }).select(LEAD_COLUMNS)
  );
  if (inserted.length) return { lead: inserted[0], created: true };

  const lead = unwrap(await db.from("leads").select(LEAD_COLUMNS).eq("email", email).single());
  return { lead, created: false };
}

// Leads without an email are matched on phone
async function ensureLeadByPhone(db, phone, fields) {
  const matches = unwrap(await db.from("leads").select(LEAD_COLUMNS).eq("phone", phone).limit(1));
  if (matches.length) return { lead: matches[0], created: false };

  const lead = unwrap(await db.from("leads").insert({ phone, ...fields }).select(LEAD_COLUMNS).single());
  return { lead, created: true };
}

async function logActivity(db, leadId, type, fields = {}) {
  unwrap(await db.from("activities").insert({ lead_id: leadId, type, ...fields }));
}

async function enrollInDrips(db, lead) {
  const campaigns = unwrap(
    await db.from("drip_campaigns").select("id, trigger_value").eq("is_active", true).eq("trigger_type", "lead_created")
  );

  for (const campaign of campaigns) {
    if (campaign.trigger_value && campaign.trigger_value !== lead.lead_type) continue;

    const steps = unwrap(
      await db.from("drip_steps").select("delay_days, delay_hours").eq("campaign_id", campaign.id).eq("is_active", true).order("step_order").limit(1)
    );
    if (!steps.length) continue;

    const delayHours = steps[0].delay_days * 24 + (steps[0].delay_hours || 0);
    unwrap(
      await db.from("drip_enrollments").upsert(
        {
          lead_id: lead.id,
          campaign_id: campaign.id,
          next_send_at: new Date(Date.now() + delayHours * 3600000).toISOString(),
        },
        { onConflict: "lead_id,campaign_id", ignoreDuplicates: true }
      )
    );
  }
}

// Saving the lead matters more than these follow-ups, so a failure here is only logged
async function onLeadCreated(db, lead, hasEmail) {
  try {
    unwrap(await db.rpc("assign_lead_round_robin", { p_lead_id: lead.id }));
    if (hasEmail) await enrollInDrips(db, lead);
  } catch (err) {
    console.error("lead follow-up failed:", err.message);
  }
}

// Finds or creates a lead from contact details. A repeat contact only fills in
// what arrived, so a partial form never wipes existing fields.
async function saveContact(db, { email, phone, firstName, lastName, source, createdMessage }) {
  const leadData = {
    first_name: firstName || null,
    last_name: lastName || null,
    phone: phone || null,
    source: leadSource(source),
    source_detail: source || "Camelback Home Group Website",
  };

  const { lead, created } = email ? await ensureLead(db, email, leadData) : await ensureLeadByPhone(db, phone, leadData);

  if (created) {
    await logActivity(db, lead.id, "lead_created", { message: createdMessage });
    await onLeadCreated(db, lead, !!email);
  } else {
    const updateData = {};
    if (firstName) updateData.first_name = firstName;
    if (lastName) updateData.last_name = lastName;
    if (phone) updateData.phone = phone;
    if (Object.keys(updateData).length) {
      unwrap(await db.from("leads").update(updateData).eq("id", lead.id));
    }
  }

  return { lead, created, source: leadData.source };
}

module.exports = { unwrap, normalizeEmail, ensureLead, logActivity, saveContact };
