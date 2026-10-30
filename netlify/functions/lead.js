// Supabase CRM integration
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (server-side only, never expose to client)
//
// Actions:
//   create        — upsert lead by email, assign an agent, enroll in drips (default)
//   update        — update existing lead fields
//   addNote       — add to lead's activity timeline
//   getLead       — lead name + favorites, for restoring a website session
//   propertyView  — record a listing view
//   siteVisit     — record a site visit
//   saveListing   — add a favorite
//   removeListing — remove a favorite

const { createClient } = require("@supabase/supabase-js");

const LEAD_COLUMNS = "id, first_name, last_name, phone, lead_type";
const MAX_INT = 2147483647;

// Older cached copies of lead-capture.js send favorites through `update`
const LEGACY_FAVORITES_MARKER = "CHG_FAVORITES:";

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase() || null;
}

function toInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n <= MAX_INT ? n : null;
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

// property.html sends the SimplyRETS id; lead-capture.js sends it in the listing link
function propertyIdFrom(body) {
  if (body.propertyId) return String(body.propertyId);
  const match = /[?&]id=(\w+)/.exec(body.partnerLink || "");
  return match ? match[1] : String(body.mlsNumber);
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { action = "create" } = body;
  const email = normalizeEmail(body.email);

  if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase is not configured; lead action dropped:", action);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, crm: "none" }) };
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const ok = (extra) => ({
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, crm: "supabase", action, ...extra }),
  });

  try {
    // --- GET lead data. This endpoint is public, so return only what the site needs ---
    if (action === "getLead") {
      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email required" }) };
      }
      const lead = unwrap(await db.from("leads").select("id, first_name, last_name").eq("email", email).maybeSingle());
      if (!lead) {
        return ok({ success: false, data: null });
      }
      const rows = unwrap(
        await db.from("favorites").select("property_id, mls_number, property_price, property_city, property_address, saved_at").eq("lead_id", lead.id)
      );
      const favorites = {};
      for (const row of rows) {
        favorites[row.property_id] = {
          mlsNumber: row.mls_number || "",
          price: row.property_price || 0,
          city: row.property_city || "",
          address: row.property_address || "",
          savedAt: row.saved_at,
        };
      }
      return ok({ data: { firstName: lead.first_name || "", lastName: lead.last_name || "", favorites } });
    }

    // --- RECORD PROPERTY VIEW ---
    if (action === "propertyView") {
      const { mlsNumber, partnerLink } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required for propertyView" }) };
      }
      const { lead } = await ensureLead(db, email);
      await logActivity(db, lead.id, "listing_view", {
        property_id: propertyIdFrom(body),
        mls_number: String(mlsNumber),
        page_url: partnerLink || null,
      });
      return ok();
    }

    // --- RECORD SITE VISIT ---
    if (action === "siteVisit") {
      const { url: visitUrl } = body;
      if (!email || !visitUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and url required for siteVisit" }) };
      }
      const { lead } = await ensureLead(db, email);
      await logActivity(db, lead.id, "site_visit", { page_url: visitUrl });
      return ok();
    }

    // --- SAVE LISTING as favorite ---
    if (action === "saveListing") {
      const { mlsNumber, price, city, address } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required" }) };
      }
      const { lead } = await ensureLead(db, email);
      const propertyId = propertyIdFrom(body);
      const listing = {
        property_id: propertyId,
        // Without a separate propertyId, mlsNumber is only known to be the SimplyRETS id
        mls_number: body.propertyId && String(mlsNumber) !== propertyId ? String(mlsNumber) : null,
        property_address: address || null,
        property_price: toInt(price),
        property_city: city || null,
      };
      const added = unwrap(
        await db.from("favorites").upsert({ lead_id: lead.id, ...listing }, { onConflict: "lead_id,property_id", ignoreDuplicates: true }).select("id")
      );
      if (added.length) await logActivity(db, lead.id, "favorite_add", listing);
      return ok();
    }

    // --- REMOVE SAVED LISTING ---
    if (action === "removeListing") {
      const { mlsNumber } = body;
      if (!email || !mlsNumber) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required" }) };
      }
      const { lead } = await ensureLead(db, email);
      const removed = unwrap(
        await db
          .from("favorites")
          .delete()
          .eq("lead_id", lead.id)
          .eq("property_id", propertyIdFrom(body))
          .select("property_id, mls_number, property_address, property_price, property_city")
      );
      if (removed.length) await logActivity(db, lead.id, "favorite_remove", removed[0]);
      return ok();
    }

    // --- ADD NOTE to existing lead's timeline ---
    if (action === "addNote") {
      const { message } = body;
      if (!email || !message) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and message required for addNote" }) };
      }
      const { lead } = await ensureLead(db, email);
      await logActivity(db, lead.id, "note", { message });
      return ok();
    }

    // --- UPDATE existing lead ---
    if (action === "update") {
      const { firstName, lastName, phone, note, source, tags, shortSummary, minPrice, maxPrice } = body;
      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email required for update" }) };
      }
      const updateData = {};
      if (firstName) updateData.first_name = firstName;
      if (lastName) updateData.last_name = lastName;
      if (phone) updateData.phone = phone;
      if (source) updateData.source_detail = source;
      if (Array.isArray(tags)) updateData.tags = tags;
      if (shortSummary) updateData.short_summary = shortSummary;
      if (toInt(minPrice)) updateData.min_price = toInt(minPrice);
      if (toInt(maxPrice)) updateData.max_price = toInt(maxPrice);

      const { lead } = await ensureLead(db, email);
      if (Object.keys(updateData).length) {
        unwrap(await db.from("leads").update(updateData).eq("id", lead.id));
      }
      if (note && !note.startsWith(LEGACY_FAVORITES_MARKER)) {
        await logActivity(db, lead.id, "note", { message: note });
      }
      return ok();
    }

    // --- CREATE new lead (default) ---
    const { firstName, lastName, phone, propertyAddress, propertyMlsId, source, note } = body;

    if (!email && !phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email or phone required" }) };
    }

    const leadData = {
      first_name: firstName || null,
      last_name: lastName || null,
      phone: phone || null,
      source: leadSource(source),
      source_detail: source || "Camelback Home Group Website",
    };

    const { lead, created } = email ? await ensureLead(db, email, leadData) : await ensureLeadByPhone(db, phone, leadData);

    if (created) {
      await logActivity(db, lead.id, "lead_created", { message: "Website lead registration" });
      await onLeadCreated(db, lead, !!email);
    } else {
      // The popup creates at each step and forms re-submit; only fill in what arrived
      const updateData = {};
      if (firstName) updateData.first_name = firstName;
      if (lastName) updateData.last_name = lastName;
      if (phone) updateData.phone = phone;
      if (Object.keys(updateData).length) {
        unwrap(await db.from("leads").update(updateData).eq("id", lead.id));
      }
    }

    if (note || propertyAddress) {
      await logActivity(db, lead.id, leadData.source === "property_inquiry" ? "property_inquiry" : "form_submit", {
        property_id: propertyMlsId ? String(propertyMlsId) : null,
        property_address: propertyAddress || null,
        message: note || `Interested in: ${propertyAddress}${propertyMlsId ? " (MLS# " + propertyMlsId + ")" : ""}`,
      });
    }

    return ok({ leadId: lead.id });
  } catch (err) {
    console.error("lead action failed:", action, err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, crm: "fallback" }),
    };
  }
};
