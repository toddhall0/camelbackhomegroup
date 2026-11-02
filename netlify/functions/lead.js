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
//   search        — record a listing search
//   trackBatch    — record listing views and searches from before the visitor logged in
//   siteVisit     — record a site visit
//   saveListing   — add a favorite
//   removeListing — remove a favorite

const { createClient } = require("@supabase/supabase-js");
const { unwrap, normalizeEmail, ensureLead, logActivity, saveContact } = require("../lib/crm");

const MAX_INT = 2147483647;
const MAX_BATCH = 50;
const MAX_BATCH_AGE_MS = 90 * 24 * 3600000;
const SEARCH_FILTERS = ["minPrice", "maxPrice", "minBeds", "minBaths", "minSqft", "maxSqft", "sort"];
const LEAD_TYPES = ["buyer", "seller", "both", "investor"];

// Older cached copies of lead-capture.js send favorites through `update`
const LEGACY_FAVORITES_MARKER = "CHG_FAVORITES:";

function toInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n <= MAX_INT ? n : null;
}

// property.html sends the SimplyRETS id; lead-capture.js sends it in the listing link
function propertyIdFrom(body) {
  if (body.propertyId) return String(body.propertyId);
  const match = /[?&]id=(\w+)/.exec(body.partnerLink || "");
  return match ? match[1] : String(body.mlsNumber);
}

function listingViewFields(body) {
  return {
    property_id: propertyIdFrom(body),
    mls_number: body.mlsNumber ? String(body.mlsNumber) : null,
    property_address: body.address || null,
    property_price: toInt(body.price),
    property_city: body.city || null,
    page_url: body.partnerLink || null,
  };
}

function searchFields(body) {
  const filters = {};
  for (const key of SEARCH_FILTERS) {
    if (body.filters && body.filters[key] != null && body.filters[key] !== "") filters[key] = body.filters[key];
  }
  return { message: String(body.query).slice(0, 200), metadata: { filters } };
}

// Keeps the time the visitor actually did it, within reason: the browser supplies this
function pastTime(value) {
  const time = new Date(value).getTime();
  const now = Date.now();
  return time && time <= now && now - time <= MAX_BATCH_AGE_MS ? new Date(time).toISOString() : undefined;
}

// Browsing a visitor did before we knew who they were, kept in their own browser until now
async function recordEvents(db, leadId, events) {
  if (!Array.isArray(events)) return;
  for (const event of events.slice(-MAX_BATCH)) {
    const createdAt = pastTime(event.at);
    const timing = createdAt ? { created_at: createdAt } : {};
    if (event.action === "propertyView" && (event.mlsNumber || event.propertyId)) {
      await logActivity(db, leadId, "listing_view", { ...listingViewFields(event), ...timing });
    } else if (event.action === "search" && event.query) {
      await logActivity(db, leadId, "search", { ...searchFields(event), ...timing });
    }
  }
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
      if (!email || !(body.mlsNumber || body.propertyId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and mlsNumber required for propertyView" }) };
      }
      const { lead } = await ensureLead(db, email);
      await logActivity(db, lead.id, "listing_view", listingViewFields(body));
      return ok();
    }

    // --- RECORD SEARCH ---
    if (action === "search") {
      if (!email || !body.query) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and query required for search" }) };
      }
      const { lead } = await ensureLead(db, email);
      await logActivity(db, lead.id, "search", searchFields(body));
      return ok();
    }

    // --- RECORD BROWSING FROM BEFORE LOGIN ---
    if (action === "trackBatch") {
      if (!email || !Array.isArray(body.events)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and events required for trackBatch" }) };
      }
      const { lead } = await ensureLead(db, email);
      await recordEvents(db, lead.id, body.events);
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

    const { lead, source: leadType } = await saveContact(db, {
      email,
      phone,
      firstName,
      lastName,
      source,
      leadType: LEAD_TYPES.includes(body.leadType) ? body.leadType : null,
      createdMessage: "Website lead registration",
    });

    if (note || propertyAddress) {
      await logActivity(db, lead.id, leadType === "property_inquiry" ? "property_inquiry" : "form_submit", {
        property_id: propertyMlsId ? String(propertyMlsId) : null,
        property_address: propertyAddress || null,
        message: note || `Interested in: ${propertyAddress}${propertyMlsId ? " (MLS# " + propertyMlsId + ")" : ""}`,
      });
    }

    await recordEvents(db, lead.id, body.events);

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
